import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, RequestUser } from '../interfaces/jwt-payload.interface';

/**
 * JwtStrategy — Passport strategy for all admin/user API routes.
 *
 * Extracts Bearer token from the Authorization header.
 * Validates signature + expiry using JWT_ACCESS_SECRET.
 *
 * The validate() return value becomes request.user (type: RequestUser).
 *
 * Security:
 *   - type: 'access' check prevents refresh tokens from being used as access tokens
 *   - Does NOT hit the DB on every request (stateless — token expiry is the revocation)
 *   - Refresh token revocation is DB-checked only at /auth/refresh
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): RequestUser {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      isSuperAdmin: payload.isSuperAdmin ?? false,
    };
  }
}
