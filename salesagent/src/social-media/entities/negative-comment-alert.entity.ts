import { Column, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Entity } from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { CommentSentiment, NegativeAlertStatus } from '../../common/enums';
import { SocialComment } from './social-comment.entity';

/**
 * NegativeCommentAlert — surfaced on the admin dashboard and optionally emailed.
 *
 * Created by SocialCommentAnalyzeWorker when sentiment is NEGATIVE or CRITICAL.
 * Admins resolve alerts (with optional notes) via the REST API.
 */
@Entity('negative_comment_alerts')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'sentiment'])
export class NegativeCommentAlert extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'comment_id' })
  commentId: string;

  @Column({ type: 'enum', enum: CommentSentiment })
  sentiment: CommentSentiment;

  /** Human-readable reason the alert was raised (from CommentAnalysis). */
  @Column({ type: 'text', name: 'alert_reason' })
  alertReason: string;

  @Column({
    type: 'enum',
    enum: NegativeAlertStatus,
    default: NegativeAlertStatus.OPEN,
  })
  status: NegativeAlertStatus;

  /** Whether the dashboard WebSocket event was successfully emitted. */
  @Column({ type: 'boolean', name: 'ws_emitted', default: false })
  wsEmitted: boolean;

  /** Whether the alert email was sent to the tenant's notification address. */
  @Column({ type: 'boolean', name: 'email_sent', default: false })
  emailSent: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'email_sent_at' })
  emailSentAt: Date | null;

  @Column({ type: 'text', nullable: true, name: 'resolution_notes' })
  resolutionNotes: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => SocialComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment: SocialComment;
}
