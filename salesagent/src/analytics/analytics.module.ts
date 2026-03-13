import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationMessage } from '../conversations/entities/conversation-message.entity';
import { Lead } from '../leads/entities/lead.entity';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk } from '../knowledge/entities/knowledge-chunk.entity';
import { AnalyticsDailySnapshot } from './entities/analytics-daily-snapshot.entity';

import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsAggregationWorker } from './workers/analytics-aggregation.worker';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * AnalyticsModule
 *
 * Read-only aggregation over cross-module entities.
 * Registers its own TypeORM features rather than importing other modules
 * to avoid circular dependencies.
 *
 * Two-tier data access:
 *   1. Real-time: AnalyticsService runs aggregate queries on live tables.
 *      Used by GET /analytics/summary for today's data.
 *   2. Pre-aggregated: AnalyticsDailySnapshot stores nightly rollups.
 *      Used by the trend endpoint for historical data (fast, no full scans).
 *
 * Workers:
 *   AnalyticsAggregationWorker — nightly snapshot computation per tenant
 *
 * Endpoints:
 *   GET /analytics/summary?preset=30d   — live stats
 *   GET /analytics/trends               — historical from daily snapshots
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMessage,
      Lead,
      KnowledgeDocument,
      KnowledgeChunk,
      AnalyticsDailySnapshot,
    ]),

    BullModule.registerQueue({ name: QUEUE_NAMES.ANALYTICS_AGGREGATION }),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsAggregationWorker,
  ],
})
export class AnalyticsModule {}
