import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Job } from 'bullmq';

import { AnalyticsAggregationJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';
import {
  AnalyticsDailySnapshot,
  DailyMetrics,
} from '../entities/analytics-daily-snapshot.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { ConversationMessage } from '../../conversations/entities/conversation-message.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { ConversationStatus, LeadStatus } from '../../common/enums';

/**
 * AnalyticsAggregationWorker — BullMQ processor for the 'analytics-aggregation' queue.
 *
 * Pre-aggregates daily metrics per tenant into the analytics_daily_snapshots table.
 * This prevents slow full-table scans on the dashboard trend endpoint.
 *
 * Trigger points:
 *   1. Nightly cron (scheduled via BullMQ cron job at 02:00 UTC)
 *   2. On-demand via POST /analytics/aggregate (admin endpoint, idempotent)
 *
 * Idempotency:
 *   Uses INSERT ... ON CONFLICT (tenant_id, date) DO UPDATE — safe to run multiple times.
 *
 * Retry policy: TRANSIENT (3 attempts, 10s backoff) — DB queries may transiently fail.
 *
 * Concurrency: 2 — analytics queries can be heavy; cap parallelism.
 */
@Processor(QUEUE_NAMES.ANALYTICS_AGGREGATION, { concurrency: 2 })
export class AnalyticsAggregationWorker extends WorkerHost {
  private readonly logger = new Logger(AnalyticsAggregationWorker.name);

  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(AnalyticsDailySnapshot)
    private readonly snapshotRepo: Repository<AnalyticsDailySnapshot>,

    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(ConversationMessage)
    private readonly messageRepo: Repository<ConversationMessage>,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
  ) {
    super();
  }

  async process(job: Job<AnalyticsAggregationJob>): Promise<void> {
    const { tenantId, date } = job.data;

    this.logger.log(`Aggregating analytics: tenantId=${tenantId} date=${date}`);

    const metrics = await this.computeMetrics(tenantId, date);

    // Upsert — safe to re-run for the same date
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(AnalyticsDailySnapshot)
      .values({
        tenantId,
        date,
        metrics,
        computedAt: new Date(),
      })
      .orUpdate(
        ['metrics', 'computed_at'],
        ['tenant_id', 'date'],
      )
      .execute();

    this.logger.log(
      `Analytics snapshot upserted: tenantId=${tenantId} date=${date} ` +
      `conversations=${metrics.conversationCount} leads=${metrics.leadCount}`,
    );
  }

  // ─── Metric computation ──────────────────────────────────────────────────

  private async computeMetrics(tenantId: string, date: string): Promise<DailyMetrics> {
    // Date window: midnight-to-midnight in UTC
    const from = new Date(`${date}T00:00:00.000Z`);
    const to = new Date(`${date}T23:59:59.999Z`);

    const [convStats, msgStats, leadStats] = await Promise.all([
      this.computeConversationStats(tenantId, from, to),
      this.computeMessageStats(tenantId, from, to),
      this.computeLeadStats(tenantId, from, to),
    ]);

    return {
      ...convStats,
      ...msgStats,
      ...leadStats,
    };
  }

  private async computeConversationStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Pick<DailyMetrics, 'conversationCount' | 'avgConversationDurationSecs' | 'activeConversationCount' | 'endedConversationCount' | 'stageBreakdown'>> {
    const rows = await this.conversationRepo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('c.current_stage', 'stage')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect(
        `AVG(CASE WHEN c.ended_at IS NOT NULL THEN EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) END)`,
        'avgDuration',
      )
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.started_at >= :from', { from })
      .andWhere('c.started_at <= :to', { to })
      .groupBy('c.status, c.current_stage')
      .getRawMany<{ status: string; stage: string; cnt: string; avgDuration: string | null }>();

    let conversationCount = 0;
    let activeCount = 0;
    let endedCount = 0;
    let totalDuration = 0;
    let durationSamples = 0;
    const stageBreakdown: Record<string, number> = {};

    for (const row of rows) {
      const cnt = parseInt(row.cnt, 10);
      conversationCount += cnt;
      if (row.status === ConversationStatus.ACTIVE) activeCount += cnt;
      if (row.status === ConversationStatus.ENDED) endedCount += cnt;
      if (row.avgDuration) {
        totalDuration += parseFloat(row.avgDuration) * cnt;
        durationSamples += cnt;
      }
      stageBreakdown[row.stage] = (stageBreakdown[row.stage] ?? 0) + cnt;
    }

    return {
      conversationCount,
      activeConversationCount: activeCount,
      endedConversationCount: endedCount,
      avgConversationDurationSecs:
        durationSamples > 0 ? Math.round(totalDuration / durationSamples) : 0,
      stageBreakdown,
    };
  }

  private async computeMessageStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Pick<DailyMetrics, 'messageCount' | 'totalTokens' | 'avgTokensPerConversation'>> {
    const row = await this.messageRepo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'msgCount')
      .addSelect('COALESCE(SUM(m.token_count), 0)', 'totalTokens')
      .addSelect('COUNT(DISTINCT m.conversation_id)', 'convCount')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.created_at >= :from', { from })
      .andWhere('m.created_at <= :to', { to })
      .getRawOne<{ msgCount: string; totalTokens: string; convCount: string }>();

    const msgCount = parseInt(row?.msgCount ?? '0', 10);
    const totalTokens = parseInt(row?.totalTokens ?? '0', 10);
    const convCount = parseInt(row?.convCount ?? '1', 10);

    return {
      messageCount: msgCount,
      totalTokens,
      avgTokensPerConversation: convCount > 0 ? Math.round(totalTokens / convCount) : 0,
    };
  }

  private async computeLeadStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Pick<DailyMetrics, 'leadCount' | 'newLeadCount' | 'qualifiedLeadCount' | 'convertedLeadCount' | 'avgLeadScore'>> {
    const rows = await this.leadRepo
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('AVG(l.score)', 'avgScore')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere('l.created_at >= :from', { from })
      .andWhere('l.created_at <= :to', { to })
      .groupBy('l.status')
      .getRawMany<{ status: string; cnt: string; avgScore: string }>();

    let leadCount = 0;
    let newCount = 0;
    let qualifiedCount = 0;
    let convertedCount = 0;
    let totalScore = 0;

    for (const row of rows) {
      const cnt = parseInt(row.cnt, 10);
      leadCount += cnt;
      if (row.status === LeadStatus.NEW) newCount += cnt;
      if (row.status === LeadStatus.QUALIFIED) qualifiedCount += cnt;
      if (row.status === LeadStatus.CONVERTED) convertedCount += cnt;
      totalScore += parseFloat(row.avgScore ?? '0') * cnt;
    }

    return {
      leadCount,
      newLeadCount: newCount,
      qualifiedLeadCount: qualifiedCount,
      convertedLeadCount: convertedCount,
      avgLeadScore: leadCount > 0 ? Math.round(totalScore / leadCount) : 0,
    };
  }

  // ─── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<AnalyticsAggregationJob>): void {
    this.logger.log(
      `Analytics aggregation done: tenantId=${job.data.tenantId} date=${job.data.date} ` +
      `latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AnalyticsAggregationJob> | undefined, err: Error): void {
    this.logger.error(
      `Analytics aggregation failed: tenantId=${job?.data.tenantId} date=${job?.data.date} ` +
      `attempts=${job?.attemptsMade}: ${err.message}`,
    );
  }
}
