import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';

import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { UsersService } from '../../users/services/users.service';
import { TenantsService } from '../../tenants/services/tenants.service';
import {
  JwtPayload,
  RefreshTokenPayload,
  WidgetJwtPayload,
} from '../interfaces/jwt-payload.interface';
import { TokenResponseDto, } from '../dtos/token-response.dto';
import { WidgetSessionResponseDto } from '../dtos/widget-session.dto';
import { TenantMemberRole, UserStatus } from '../../common/enums';

/**
 * AuthService — the core authentication engine.
 *
 * ─── Access token ────────────────────────────────────────────────────────────
 * Stateless JWT (15m). Contains userId, tenantId, role, isSuperAdmin.
 * Validated by JwtStrategy on every protected request without a DB lookup.
 * Revocation is NOT supported for access tokens (by design — short TTL).
 * If immediate revocation is needed (e.g. account suspended), use JwtAuthGuard
 * to also check a Redis blocklist (future enhancement).
 *
 * ─── Refresh token ────────────────────────────────────────────────────────────
 * Long-lived JWT (7d) with a jti (UUID) stored in the DB.
 * On /auth/refresh: JWT signature is verified → DB record checked (not revoked,
 * not expired) → old record revoked → new token pair issued.
 * Token theft detection: if a revoked refresh token is presented,
 * AuthService revokes ALL tokens for that user (family invalidation).
 *
 * ─── Widget session ──────────────────────────────────────────────────────────
 * Anonymous visitor JWT (24h). No DB record — stateless.
 * Signed with separate JWT_WIDGET_SECRET.
 *
 * ─── Super-admin ─────────────────────────────────────────────────────────────
 * isSuperAdmin: true is embedded in the JWT if user.email matches SUPER_ADMIN_EMAIL.
 * No DB column change needed — controlled by environment config.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly superAdminEmail: string | undefined;
  private readonly accessExpiresIn: number; // seconds
  private readonly refreshExpiresIn: number; // seconds
  private readonly widgetExpiresIn: number; // seconds

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,

    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {
    this.superAdminEmail = config.get<string>('SUPER_ADMIN_EMAIL');
    // Parse "15m" / "7d" into seconds for expiresIn response field
    this.accessExpiresIn = this.parseTtlToSeconds(
      config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    );
    this.refreshExpiresIn = this.parseTtlToSeconds(
      config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
    this.widgetExpiresIn = this.parseTtlToSeconds(
      config.get<string>('JWT_WIDGET_EXPIRES_IN', '24h'),
    );
  }

  // ─── Credential validation (called by LocalStrategy) ─────────────────────

  /**
   * Validate email + password. Returns User on success, null on failure.
   * Intentionally returns null (not throws) — LocalStrategy converts to 401.
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmailForAuth(email.toLowerCase());
    if (!user) return null;
    if (user.status !== UserStatus.ACTIVE) return null;

    const valid = await this.usersService.verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    return user;
  }

  // ─── Login (called by AuthController after LocalAuthGuard) ───────────────

  /**
   * Issue access + refresh tokens for an authenticated user.
   * The tenantId comes from the user's primary (or only) active membership.
   *
   * If the user belongs to multiple tenants, pass tenantId explicitly via
   * POST /auth/login body (optional field). Defaults to the first found.
   */
  async login(
    user: User,
    requestedTenantId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    // Resolve tenant context and role
    const tenantId = requestedTenantId ?? await this.resolvePrimaryTenantId(user.id);
    const membership = await this.usersService.findMembership(user.id, tenantId);

    if (!membership) {
      throw new ForbiddenException(
        `User is not an active member of tenant ${tenantId}`,
      );
    }

    const isSuperAdmin =
      !!this.superAdminEmail && user.email === this.superAdminEmail;

    // Update last login timestamp (fire-and-forget)
    void this.updateLastLogin(user.id);

    return this.issueTokenPair(
      user.id,
      tenantId,
      membership.role,
      isSuperAdmin,
      ipAddress,
      userAgent,
    );
  }

  // ─── Refresh (rotate refresh token) ──────────────────────────────────────

  async refreshTokens(
    rawRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    // 1. Verify JWT signature + expiry
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // 2. Look up DB record by jti
    const record = await this.refreshTokenRepo.findOne({ where: { jti: payload.jti } });
    if (!record) {
      throw new UnauthorizedException('Refresh token not found');
    }

    // 3. Detect token reuse (theft detection)
    if (record.revokedAt !== null) {
      this.logger.warn(
        `Refresh token reuse detected: jti=${payload.jti} userId=${payload.sub} ` +
        `reason=${record.revokedReason}. Revoking all tokens.`,
      );
      // Family invalidation: revoke all tokens for this user
      await this.revokeAllForUser(payload.sub, 'admin');
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // 4. Rotate — revoke old, issue new
    await this.refreshTokenRepo.update(record.id, {
      revokedAt: new Date(),
      revokedReason: 'rotated',
    });

    // Re-resolve membership in case role changed since last login
    const membership = await this.usersService.findMembership(payload.sub, payload.tenantId);
    if (!membership) {
      throw new ForbiddenException('Tenant membership revoked');
    }

    const isSuperAdmin = payload.isSuperAdmin ?? false;

    return this.issueTokenPair(
      payload.sub,
      payload.tenantId,
      membership.role,
      isSuperAdmin,
      ipAddress,
      userAgent,
    );
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(rawRefreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      // Token already expired — nothing to revoke
      return;
    }

    await this.refreshTokenRepo.update(
      { jti: payload.jti },
      { revokedAt: new Date(), revokedReason: 'logout' },
    );
  }

  // ─── Widget session ───────────────────────────────────────────────────────

  /**
   * Issue an anonymous visitor JWT for the widget.
   * Validates the widgetKey to ensure it belongs to an active tenant.
   */
  async issueWidgetSession(
    widgetKey: string,
    existingVisitorId?: string,
  ): Promise<WidgetSessionResponseDto> {
    const tenant = await this.tenantsService.findByWidgetKey(widgetKey);
    if (!tenant || !tenant.isActive) {
      throw new UnauthorizedException('Invalid or inactive widget key');
    }

    const visitorId = existingVisitorId ?? randomUUID();

    const widgetPayload: WidgetJwtPayload = {
      sub: visitorId,
      tenantId: tenant.id,
      widgetKey,
      type: 'visitor',
    };

    const visitorToken = this.jwtService.sign(widgetPayload, {
      secret: this.config.getOrThrow<string>('JWT_WIDGET_SECRET'),
      expiresIn: this.config.get<string>('JWT_WIDGET_EXPIRES_IN', '24h'),
    });

    return {
      visitorToken,
      visitorId,
      tenantId: tenant.id,
      expiresIn: this.widgetExpiresIn,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async issueTokenPair(
    userId: string,
    tenantId: string,
    role: TenantMemberRole,
    isSuperAdmin: boolean,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    // Access token (short-lived, stateless)
    const accessPayload: JwtPayload = {
      sub: userId,
      tenantId,
      role,
      type: 'access',
      isSuperAdmin: isSuperAdmin || undefined,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    // Refresh token (long-lived, DB-tracked)
    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      tenantId,
      type: 'refresh',
      jti,
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    // Persist refresh token record
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.refreshExpiresIn * 1000);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId,
        tenantId,
        jti,
        tokenHash,
        expiresAt,
        revokedAt: null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessExpiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Resolve the primary tenant for a user with exactly one active membership.
   * Multi-tenant users must specify tenantId in the login request body.
   * This is a safety net for single-tenant users only.
   */
  private async resolvePrimaryTenantId(userId: string): Promise<string> {
    // Use the TenantMember repo via the refresh token repo's manager (same EntityManager)
    const members = await this.refreshTokenRepo.manager.find('tenant_members', {
      where: { userId, status: 'active' },
      select: ['tenantId'],
    } as Parameters<typeof this.refreshTokenRepo.manager.find>[1]);

    const tenantIds = (members as Array<{ tenantId: string }>).map((m) => m.tenantId);

    if (tenantIds.length === 0) {
      throw new ForbiddenException('User has no active tenant membership');
    }
    if (tenantIds.length > 1) {
      throw new ForbiddenException(
        'User belongs to multiple tenants. Specify tenantId in the login request.',
      );
    }

    return tenantIds[0];
  }

  private async revokeAllForUser(userId: string, reason: 'admin'): Promise<void> {
    // Update all non-revoked tokens for this user (WHERE revoked_at IS NULL)
    await this.refreshTokenRepo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  private async updateLastLogin(userId: string): Promise<void> {
    try {
      await this.refreshTokenRepo.manager
        .createQueryBuilder()
        .update('users')
        .set({ last_login_at: new Date() })
        .where('id = :id', { id: userId })
        .execute();
    } catch (err) {
      this.logger.warn(`Failed to update last_login_at for user ${userId}: ${String(err)}`);
    }
  }

  /** Parse '15m' → 900, '7d' → 604800, '24h' → 86400 */
  private parseTtlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900; // default 15m
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] ?? 1);
  }
}
