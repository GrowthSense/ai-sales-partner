import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

export interface DailyMetrics {
  // Conversations
  conversationCount: number;
  avgConversationDurationSecs: number;
  activeConversationCount: number;
  endedConversationCount: number;

  // Messages
  messageCount: number;
  totalTokens: number;
  avgTokensPerConversation: number;

  // Leads
  leadCount: number;
  newLeadCount: number;
  qualifiedLeadCount: number;
  convertedLeadCount: number;
  avgLeadScore: number;

  // Stage funnel
  stageBreakdown: Record<string, number>;
}

/**
 * AnalyticsDailySnapshot — pre-aggregated daily metrics per tenant.
 *
 * Computed by the AnalyticsAggregationWorker (nightly cron or on-demand).
 * Enables fast historical trend queries without re-scanning millions of rows.
 *
 * The dashboard trend endpoint reads from this table while the live
 * summary endpoint still runs real-time queries for today.
 */
@Entity('analytics_daily_snapshots')
@Index(['tenantId', 'date'], { unique: true })
export class AnalyticsDailySnapshot extends TenantScopedEntity {
  /** ISO date (YYYY-MM-DD) — one row per tenant per day. */
  @Column({ type: 'date', nullable: false })
  date: string;

  @Column({ type: 'jsonb', nullable: false })
  metrics: DailyMetrics;

  /** When this snapshot was last computed. */
  @Column({ type: 'timestamptz', name: 'computed_at', nullable: false })
  computedAt: Date;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
