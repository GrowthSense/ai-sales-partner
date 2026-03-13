import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { IsEmail, IsString, IsOptional, MinLength, IsEnum } from 'class-validator';

import { User } from '../entities/user.entity';
import { TenantMember } from '../../tenants/entities/tenant-member.entity';
import { UserStatus, TenantMemberRole, TenantMemberStatus } from '../../common/enums';

const BCRYPT_ROUNDS = 12;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(TenantMemberRole)
  role: TenantMemberRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * UsersService
 *
 * Manages User records and their TenantMember memberships.
 *
 * Key multi-tenant rules:
 *   - Email is globally unique at the User level (a user can belong to multiple tenants)
 *   - Tenant-scoped operations always require tenantId for isolation
 *   - Passwords are hashed with bcrypt(rounds=12) — never stored plain
 *   - select: false on passwordHash means it's never accidentally returned
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(TenantMember)
    private readonly memberRepo: Repository<TenantMember>,
  ) {}

  // ─── Auth lookup (no tenant scope — email is globally unique) ─────────────

  /**
   * Find a user by email for authentication.
   * Explicitly selects passwordHash (marked select:false on entity).
   * Returns null if no user found — caller handles 401.
   */
  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.passwordHash', 'u.status', 'u.firstName', 'u.lastName'])
      .where('u.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  /**
   * Find a user's membership record for a specific tenant.
   * Used by AuthService to embed role in the JWT.
   */
  async findMembership(userId: string, tenantId: string): Promise<TenantMember | null> {
    return this.memberRepo.findOne({
      where: { userId, tenantId, status: TenantMemberStatus.ACTIVE },
    });
  }

  // ─── Tenant-scoped user queries ────────────────────────────────────────────

  async findById(id: string, tenantId: string): Promise<User> {
    const member = await this.memberRepo.findOne({
      where: { userId: id, tenantId, status: TenantMemberStatus.ACTIVE },
      relations: ['user'],
    });
    if (!member?.user) throw new NotFoundException(`User ${id} not found in tenant`);
    return member.user;
  }

  async findAll(
    tenantId: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<{ users: Array<User & { role: TenantMemberRole }>; total: number }> {
    const [members, total] = await this.memberRepo.findAndCount({
      where: { tenantId, status: TenantMemberStatus.ACTIVE },
      relations: ['user'],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      order: { createdAt: 'DESC' },
    });

    const users = members.map((m) => ({ ...m.user, role: m.role }));
    return { users, total };
  }

  // ─── User creation ─────────────────────────────────────────────────────────

  /**
   * Create a new User and their first TenantMember record atomically.
   * Called when the tenant OWNER registers the first admin user.
   */
  async create(dto: CreateUserDto, tenantId: string, role: TenantMemberRole): Promise<User> {
    const email = dto.email.toLowerCase();

    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      // User already exists globally — just add them to this tenant
      return this.addToTenant(existing.id, tenantId, role, email);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.userRepo.save(
      this.userRepo.create({
        email,
        passwordHash,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        status: UserStatus.ACTIVE,
      }),
    );

    await this.memberRepo.save(
      this.memberRepo.create({
        userId: user.id,
        tenantId,
        role,
        status: TenantMemberStatus.ACTIVE,
        invitedEmail: email,
        acceptedAt: new Date(),
      }),
    );

    this.logger.log(`User created: ${user.id} email=${email} tenantId=${tenantId} role=${role}`);
    return user;
  }

  /**
   * Invite an existing or new user to a tenant.
   * Creates a TenantMember record with status=PENDING.
   * The invite flow sends an email with an invite token (email service handles this).
   */
  async invite(dto: InviteUserDto, tenantId: string): Promise<TenantMember> {
    const email = dto.email.toLowerCase();

    // Check not already a member
    const existing = await this.memberRepo
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('u.email = :email', { email })
      .andWhere('m.status != :cancelled', { cancelled: 'cancelled' })
      .getOne();

    if (existing) {
      throw new ConflictException(`${email} is already a member or has a pending invite`);
    }

    const { randomUUID } = await import('crypto');
    const inviteToken = randomUUID();
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const member = await this.memberRepo.save(
      this.memberRepo.create({
        tenantId,
        userId: (await this.userRepo.findOne({ where: { email } }))?.id ?? randomUUID(), // placeholder if user doesn't exist yet
        role: dto.role,
        status: TenantMemberStatus.PENDING,
        invitedEmail: email,
        inviteToken,
        inviteExpiresAt,
      }),
    );

    this.logger.log(`User invited: ${email} to tenantId=${tenantId} role=${dto.role}`);
    return member;
  }

  // ─── Profile update ────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateUserDto, tenantId: string): Promise<User> {
    const user = await this.findById(id, tenantId);

    if (dto.firstName !== undefined) user.firstName = dto.firstName ?? null;
    if (dto.lastName !== undefined) user.lastName = dto.lastName ?? null;

    return this.userRepo.save(user);
  }

  async updateRole(
    userId: string,
    newRole: TenantMemberRole,
    tenantId: string,
    requestingUserId: string,
  ): Promise<TenantMember> {
    // Cannot change the OWNER role via API
    const targetMember = await this.memberRepo.findOne({ where: { userId, tenantId } });
    if (!targetMember) throw new NotFoundException('Membership not found');
    if (targetMember.role === TenantMemberRole.OWNER) {
      throw new ForbiddenException('Cannot change the OWNER role');
    }
    if (userId === requestingUserId) {
      throw new ForbiddenException('Cannot change your own role');
    }

    targetMember.role = newRole;
    return this.memberRepo.save(targetMember);
  }

  // ─── Deactivation ─────────────────────────────────────────────────────────

  async deactivate(userId: string, tenantId: string, requestingUserId: string): Promise<void> {
    const member = await this.memberRepo.findOne({ where: { userId, tenantId } });
    if (!member) throw new NotFoundException('Membership not found');
    if (member.role === TenantMemberRole.OWNER) {
      throw new ForbiddenException('Cannot remove the tenant OWNER');
    }
    if (userId === requestingUserId) {
      throw new ForbiddenException('Cannot remove yourself');
    }

    await this.memberRepo.update(member.id, { status: TenantMemberStatus.DEACTIVATED });
    this.logger.log(`User deactivated: ${userId} from tenantId=${tenantId}`);
  }

  // ─── Password ─────────────────────────────────────────────────────────────

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  async changePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepo.update(userId, { passwordHash });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async addToTenant(
    userId: string,
    tenantId: string,
    role: TenantMemberRole,
    email: string,
  ): Promise<User> {
    const existing = await this.memberRepo.findOne({ where: { userId, tenantId } });
    if (!existing) {
      await this.memberRepo.save(
        this.memberRepo.create({
          userId,
          tenantId,
          role,
          status: TenantMemberStatus.ACTIVE,
          invitedEmail: email,
          acceptedAt: new Date(),
        }),
      );
    }
    return this.userRepo.findOneOrFail({ where: { id: userId } });
  }
}
