import { Column, Index, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import { Entity } from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { SocialPlatform } from '../../common/enums';
import { SocialAccount } from './social-account.entity';
import { CommentAnalysis } from './comment-analysis.entity';

/**
 * SocialComment — a raw comment fetched from a social media platform.
 *
 * externalId + platform form a natural unique key: a comment from the same
 * platform is never stored twice (idempotent upsert in the fetch worker).
 */
@Entity('social_comments')
@Index(['tenantId', 'accountId', 'publishedAt'])
@Index(['tenantId', 'platform'])
@Index(['externalId', 'platform'], { unique: true })
export class SocialComment extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'enum', enum: SocialPlatform })
  platform: SocialPlatform;

  /** The comment ID assigned by the platform. */
  @Column({ type: 'varchar', length: 512, name: 'external_id' })
  externalId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 255, name: 'author_name' })
  authorName: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'author_username' })
  authorUsername: string | null;

  /** Email extracted from the comment text or profile (if available). */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'author_email' })
  authorEmail: string | null;

  @Column({ type: 'timestamptz', name: 'published_at' })
  publishedAt: Date;

  /** URL of the post this comment belongs to. */
  @Column({ type: 'text', nullable: true, name: 'post_url' })
  postUrl: string | null;

  // ─── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => SocialAccount, (a) => a.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: SocialAccount;

  @OneToOne(() => CommentAnalysis, (a) => a.comment, { nullable: true })
  analysis: CommentAnalysis | null;
}
