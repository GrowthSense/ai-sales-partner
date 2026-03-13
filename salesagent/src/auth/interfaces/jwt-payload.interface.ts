import { TenantMemberRole } from '../../common/enums';

/**
 * Payload embedded in the short-lived access token (15m).
 *
 * Design choices:
 *   - tenantId is embedded so every request is tenant-scoped without a DB lookup
 *   - role reflects the user's role in tenantId at login time
 *   - isSuperAdmin bypasses tenant role checks for platform-level admin endpoints
 *   - type discriminant prevents refresh tokens from being accepted as access tokens
 */
export interface JwtPayload {
  /** userId */
  sub: string;
  /** Active tenant context — set at login, not changeable without re-login */
  tenantId: string;
  /** Role in tenantId */
  role: TenantMemberRole;
  /** Distinguishes access from refresh tokens */
  type: 'access';
  /** True only for the platform super-admin (bypasses all tenant role guards) */
  isSuperAdmin?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Payload embedded in the long-lived refresh token (7d).
 *
 * The jti (JWT ID) is a UUID stored in DB as the primary key of the RefreshToken
 * record. This enables O(1) lookup and atomic revocation.
 */
export interface RefreshTokenPayload {
  sub: string;       // userId
  tenantId: string;
  type: 'refresh';
  /** Unique token ID — matches RefreshToken.jti in DB. Used to revoke on rotation. */
  jti: string;
  /** Carried forward so refresh rotation preserves super-admin status. */
  isSuperAdmin?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Payload embedded in visitor widget session tokens.
 * Signed with a separate JWT_WIDGET_SECRET to prevent privilege escalation.
 * Visitor tokens CANNOT be used on admin API routes.
 */
export interface WidgetJwtPayload {
  /** visitorId — anonymous UUID, persisted in browser storage */
  sub: string;
  tenantId: string;
  widgetKey: string;
  type: 'visitor';
  iat?: number;
  exp?: number;
}

/**
 * The shape of request.user after JwtStrategy.validate().
 * Used by @CurrentUser() and @TenantId() decorators and all guards.
 */
export interface RequestUser {
  userId: string;
  tenantId: string;
  role: TenantMemberRole;
  isSuperAdmin: boolean;
}
