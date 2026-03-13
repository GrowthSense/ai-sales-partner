import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationMessage } from '../conversations/entities/conversation-message.entity';
import { Lead } from '../leads/entities/lead.entity';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk } from '../knowledge/entities/knowledge-chunk.entity';
import { ConversationStatus, LeadStatus, DocumentStatus } from '../common/enums';

export interface PeriodSummary {
  from: Date;
  to: Date;
}

export interface ConversationStats {
  total: number;
  active: number;
  ended: number;
  abandoned: number;
  avgDurationMinutes: number | null;
}

export interface LeadStats {
  total: number;
  byStatus: Record<string, number>;
  avgScore: number | null;
  conversionRate: number;     // percentage: converted / total
  withEmail: number;
}

export interface MessageStats {
  total: number;
  avgPerConversation: number;
  totalTokens: number;
}

export interface KnowledgeStats {
  totalDocuments: number;
  readyDocuments: number;
  failedDocuments: number;
  totalChunks: number;
}

export interface AnalyticsSummary {
  period: PeriodSummary;
  conversations: ConversationStats;
  leads: LeadStats;
  messages: MessageStats;
  knowledge: KnowledgeStats;
  topStages: Array<{ stage: string; count: number }>;
}

/**
 * AnalyticsService
 *
 * Aggregation queries for the tenant admin dashboard summary.
 * Uses raw QueryBuilder aggregates rather than loading full entity lists.
 *
 * All queries are tenant-scoped and index-efficient:
 *  - Conversations: INDEX(tenantId, createdAt) + INDEX(tenantId, status)
 *  - Leads: INDEX(tenantId, status) + INDEX(tenantId, score)
 *  - Messages: INDEX(tenantId, createdAt)
 *  - Documents: INDEX(tenantId) on KnowledgeDocument
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,

    @InjectRepository(ConversationMessage)
    private readonly messageRepo: Repository<ConversationMessage>,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,

    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,

    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
  ) {}

  async getSummary(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AnalyticsSummary> {
    const [conversations, leads, messages, knowledge, topStages] = await Promise.all([
      this.getConversationStats(tenantId, from, to),
      this.getLeadStats(tenantId, from, to),
      this.getMessageStats(tenantId, from, to),
      this.getKnowledgeStats(tenantId),
      this.getTopStages(tenantId, from, to),
    ]);

    return {
      period: { from, to },
      conversations,
      leads,
      messages,
      knowledge,
      topStages,
    };
  }

  // ─── Conversation stats ───────────────────────────────────────────────────

  private async getConversationStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<ConversationStats> {
    const rows = await this.convRepo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(EXTRACT(EPOCH FROM (c.ended_at - c.created_at)) / 60)', 'avgMinutes')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.created_at BETWEEN :from AND :to', { from, to })
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string; avgMinutes: string | null }>();

    const byStatus: Record<string, number> = {};
    let totalAvgMinutes = 0;
    let endedCount = 0;

    for (const row of rows) {
      byStatus[row.status] = parseInt(row.count, 10);
      if (row.status === ConversationStatus.ENDED && row.avgMinutes !== null) {
        totalAvgMinutes = parseFloat(row.avgMinutes);
        endedCount = byStatus[row.status];
      }
    }

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    return {
      total,
      active: byStatus[ConversationStatus.ACTIVE] ?? 0,
      ended: byStatus[ConversationStatus.ENDED] ?? 0,
      abandoned: byStatus[ConversationStatus.ABANDONED] ?? 0,
      avgDurationMinutes: endedCount > 0 ? Math.round(totalAvgMinutes * 10) / 10 : null,
    };
  }

  // ─── Lead stats ───────────────────────────────────────────────────────────

  private async getLeadStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<LeadStats> {
    const rows = await this.leadRepo
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(l.score)', 'avgScore')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere('l.created_at BETWEEN :from AND :to', { from, to })
      .groupBy('l.status')
      .getRawMany<{ status: string; count: string; avgScore: string | null }>();

    const byStatus: Record<string, number> = {};
    let totalAvgScore: number | null = null;
    let scoreAccum = 0;
    let totalCount = 0;

    for (const row of rows) {
      const count = parseInt(row.count, 10);
      byStatus[row.status] = count;
      totalCount += count;
      if (row.avgScore !== null) {
        scoreAccum += parseFloat(row.avgScore) * count;
      }
    }

    if (totalCount > 0 && scoreAccum > 0) {
      totalAvgScore = Math.round((scoreAccum / totalCount) * 10) / 10;
    }

    const withEmailCount = await this.leadRepo
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere('l.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('l.email IS NOT NULL')
      .getCount();

    const converted = byStatus[LeadStatus.CONVERTED] ?? 0;
    const conversionRate = totalCount > 0 ? Math.round((converted / totalCount) * 1000) / 10 : 0;

    return {
      total: totalCount,
      byStatus,
      avgScore: totalAvgScore,
      conversionRate,
      withEmail: withEmailCount,
    };
  }

  // ─── Message stats ────────────────────────────────────────────────────────

  private async getMessageStats(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<MessageStats> {
    const raw = await this.messageRepo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'total')
      .addSelect('COALESCE(SUM(m.token_count), 0)', 'totalTokens')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.created_at BETWEEN :from AND :to', { from, to })
      .getRawOne<{ total: string; totalTokens: string }>();
    const { total, totalTokens } = raw ?? { total: '0', totalTokens: '0' };

    const convCount = await this.convRepo.count({
      where: { tenantId },
    });

    const totalMessages = parseInt(total ?? '0', 10);

    return {
      total: totalMessages,
      avgPerConversation: convCount > 0 ? Math.round((totalMessages / convCount) * 10) / 10 : 0,
      totalTokens: parseInt(totalTokens ?? '0', 10),
    };
  }

  // ─── Knowledge stats ──────────────────────────────────────────────────────

  private async getKnowledgeStats(tenantId: string): Promise<KnowledgeStats> {
    const [docRows, chunkCount] = await Promise.all([
      this.docRepo
        .createQueryBuilder('d')
        .select('d.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('d.tenant_id = :tenantId', { tenantId })
        .groupBy('d.status')
        .getRawMany<{ status: string; count: string }>(),
      this.chunkRepo.count({ where: { tenantId } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of docRows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    const totalDocs = Object.values(byStatus).reduce((a, b) => a + b, 0);

    return {
      totalDocuments: totalDocs,
      readyDocuments: byStatus[DocumentStatus.READY] ?? 0,
      failedDocuments: byStatus[DocumentStatus.FAILED] ?? 0,
      totalChunks: chunkCount,
    };
  }

  // ─── Top stages ───────────────────────────────────────────────────────────

  private async getTopStages(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ stage: string; count: number }>> {
    const rows = await this.convRepo
      .createQueryBuilder('c')
      .select('c.current_stage', 'stage')
      .addSelect('COUNT(*)', 'count')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.created_at BETWEEN :from AND :to', { from, to })
      .groupBy('c.current_stage')
      .orderBy('count', 'DESC')
      .getRawMany<{ stage: string; count: string }>();

    return rows.map((r) => ({ stage: r.stage, count: parseInt(r.count, 10) }));
  }
}
