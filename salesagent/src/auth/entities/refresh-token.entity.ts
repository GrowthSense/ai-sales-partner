import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * RefreshToken — persistent record for every issued refresh token.
 *
 * Token rotation pattern:
 *   1. Login  → create record (status: active)
 *   2. Refresh → find by jti, verify not revoked, create new record,
 *                revoke old with reason='rotated'
 *   3. Logout  → revoke by jti with reason='logout'
 *
 * The raw token is NEVER stored. Only a SHA-256 hash is persisted.
 * The JTI (JWT ID) embedded in the token JWT is used to look up the record.
 *
 * Security properties:
 *   - Revocation is O(1) by jti (indexed UUID)
 *   - Replay detection: revokedAt is set immediately on first use
 *   - Token theft detection: if a revoked token is presented, all tokens for
 *     that user can be revoked (family invalidation pattern — optional enhancement)
 */
@Entity('refresh_tokens')
@Index(['userId', 'revokedAt'])
@Index(['tenantId'])
@Index(['jti'], { unique: true })
@Index(['expiresAt'])
export class RefreshToken extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'uuid', name: 'tenant_id', nullable: false })
  tenantId: string;

  /**
   * JWT ID — a UUID embedded in the refresh token payload.
   * Primary lookup key for rotation and revocation.
   */
  @Column({ type: 'uuid', nullable: false })
  jti: string;

  /**
   * SHA-256 hex hash of the raw refresh token string.
   * Used as a secondary validation to detect token swap attacks.
   */
  @Column({ type: 'varchar', length: 64, name: 'token_hash', nullable: false, select: false })
  tokenHash: string;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: false })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  /**
   * Why this token was revoked.
   * 'logout'  — user explicitly logged out
   * 'rotated' — replaced by a new token via /auth/refresh
   * 'admin'   — revoked by platform admin or security sweep
   */
  @Column({ type: 'varchar', length: 20, name: 'revoked_reason', nullable: true })
  revokedReason: 'logout' | 'rotated' | 'admin' | null;

  /** For audit and device management (show active sessions list). */
  @Column({ type: 'varchar', length: 512, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 45, name: 'ip_address', nullable: true })
  ipAddress: string | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
