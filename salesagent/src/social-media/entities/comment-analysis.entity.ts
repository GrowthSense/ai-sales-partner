import { Column, Index, JoinColumn, OneToOne } from 'typeorm';
import { Entity } from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { CommentSentiment } from '../../common/enums';
import { SocialComment } from './social-comment.entity';

/**
 * CommentAnalysis — OpenAI-generated sentiment + lead-signal data for one comment.
 *
 * One-to-one with SocialComment (created by SocialCommentAnalyzeWorker after fetch).
 * isLeadSignal=true causes the worker to create a Lead in the existing pipeline.
 */
@Entity('comment_analyses')
@Index(['tenantId', 'sentiment'])
@Index(['tenantId', 'isLeadSignal'])
export class CommentAnalysis extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'comment_id', unique: true })
  commentId: string;

  @Column({ type: 'enum', enum: CommentSentiment })
  sentiment: CommentSentiment;

  /**
   * Confidence score from -1.0 (most negative) to +1.0 (most positive).
   */
  @Column({ type: 'float', name: 'sentiment_score' })
  sentimentScore: number;

  /**
   * Short human-readable reason produced by the LLM.
   * E.g. "Customer expresses frustration with slow delivery."
   */
  @Column({ type: 'text', nullable: true, name: 'sentiment_reason' })
  sentimentReason: string | null;

  /** True if the comment contains signals of buying intent or product interest. */
  @Column({ type: 'boolean', name: 'is_lead_signal', default: false })
  isLeadSignal: boolean;

  /** Plain-text description of detected lead signals, if any. */
  @Column({ type: 'text', nullable: true, name: 'lead_signals' })
  leadSignals: string | null;

  /** Emails extracted from the comment text by the LLM. */
  @Column({ type: 'varchar', array: true, default: [], name: 'extracted_emails' })
  extractedEmails: string[];

  /** Phones extracted from the comment text by the LLM. */
  @Column({ type: 'varchar', array: true, default: [], name: 'extracted_phones' })
  extractedPhones: string[];

  /**
   * Suggested actions for the admin team.
   * E.g. ['Reply with apology', 'Offer refund', 'Escalate to support']
   */
  @Column({ type: 'varchar', array: true, default: [], name: 'suggested_actions' })
  suggestedActions: string[];

  /** ID of the Lead created from this comment, if any. */
  @Column({ type: 'uuid', nullable: true, name: 'lead_id' })
  leadId: string | null;

  @Column({ type: 'timestamptz', name: 'analyzed_at' })
  analyzedAt: Date;

  // ─── Relations ──────────────────────────────────────────────────────────────

  @OneToOne(() => SocialComment, (c) => c.analysis, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment: SocialComment;
}
