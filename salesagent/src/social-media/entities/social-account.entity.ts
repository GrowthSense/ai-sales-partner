import { Column, Index, OneToMany } from 'typeorm';
import { Entity } from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { SocialPlatform, SocialAccountStatus } from '../../common/enums';
import { SocialComment } from './social-comment.entity';

/**
 * Encrypted credentials blob (AES-256-GCM), same pattern as TenantIntegration.
 */
export interface SocialAccountCredentials {
  encryptedData: string;
  iv: string;
  authTag: string;
}

/**
 * SocialAccount — a connected social media page/profile per tenant.
 *
 * Credentials are AES-256-GCM encrypted at rest (never returned in API responses).
 * lastSyncedAt drives the incremental fetch window in SocialCommentFetchWorker.
 */
@Entity('social_accounts')
@Index(['tenantId', 'platform'])
@Index(['tenantId', 'status'])
export class SocialAccount extends TenantScopedEntity {
  @Column({ type: 'enum', enum: SocialPlatform })
  platform: SocialPlatform;

  /** Platform-assigned page/user/channel ID. */
  @Column({ type: 'varchar', length: 255, name: 'external_id' })
  externalId: string;

  /** Human-readable page name or @handle. */
  @Column({ type: 'varchar', length: 255 })
  handle: string;

  @Column({ type: 'enum', enum: SocialAccountStatus, default: SocialAccountStatus.ACTIVE })
  status: SocialAccountStatus;

  /**
   * AES-256-GCM encrypted credentials (access token, page token, etc.).
   * Never returned by API — always `select: false`.
   */
  @Column({ type: 'jsonb', nullable: true, select: false })
  credentials: SocialAccountCredentials | null;

  /** Non-secret config (page ID, post IDs to watch, etc.). */
  @Column({ type: 'jsonb', default: '{}' })
  config: Record<string, unknown>;

  /** Cursor/timestamp used by the fetch worker to fetch only new comments. */
  @Column({ type: 'timestamptz', name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @OneToMany(() => SocialComment, (c) => c.account)
  comments: SocialComment[];
}
