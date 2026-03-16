import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Conversation, ConversationMetadata } from '../entities/conversation.entity';
import { AgentState } from '../../agents/entities/agent-state.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { ConversationStatus, ConversationStage } from '../../common/enums';

export interface ConversationFilters {
  status?: ConversationStatus;
  stage?: ConversationStage;
  agentId?: string;
  from?: Date;
  to?: Date;
  visitorId?: string;
}

export interface ConversationPagination {
  page: number;
  limit: number;
}

export interface CreateConversationOptions {
  tenantId: string;
  agentId: string;
  visitorId: string;
  metadata?: Partial<ConversationMetadata>;
}

export interface PatchConversationOptions {
  status?: ConversationStatus;
  endedAt?: Date;
}

/**
 * ConversationsService
 *
 * Manages the Conversation lifecycle: creation, stage transitions,
 * status updates, and resolution of associated AgentState and Lead.
 *
 * All methods are tenant-scoped — tenantId is always validated against
 * the record to prevent cross-tenant access.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,

    @InjectRepository(AgentState)
    private readonly stateRepo: Repository<AgentState>,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────────

  async create(opts: CreateConversationOptions): Promise<Conversation> {
    const defaultMeta: ConversationMetadata = {
      pageUrl: null,
      pageTitle: null,
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      deviceType: null,
      userAgent: null,
      ipAddress: null,
      countryCode: null,
    };

    const conv = this.convRepo.create({
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      visitorId: opts.visitorId,
      status: ConversationStatus.ACTIVE,
      currentStage: ConversationStage.GREETING,
      leadId: null,
      messageCount: 0,
      totalTokens: 0,
      endedAt: null,
      lastMessageAt: null,
      metadata: { ...defaultMeta, ...opts.metadata },
    });

    return this.convRepo.save(conv);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async findById(id: string, tenantId: string): Promise<Conversation> {
    const conv = await this.convRepo.findOne({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async findAll(
    tenantId: string,
    filters: ConversationFilters,
    pagination: ConversationPagination,
  ): Promise<[Conversation[], number]> {
    // Build a reusable filter helper — TypeORM's getManyAndCount() crashes when
    // leftJoinAndMapOne (raw table name) is combined with skip/take pagination,
    // so we run count and data as two separate queries.
    const applyFilters = (qb: ReturnType<typeof this.convRepo.createQueryBuilder>) => {
      if (filters.status) qb.andWhere('c.status = :status', { status: filters.status });
      if (filters.stage) qb.andWhere('c.current_stage = :stage', { stage: filters.stage });
      if (filters.agentId) qb.andWhere('c.agent_id = :agentId', { agentId: filters.agentId });
      if (filters.visitorId) qb.andWhere('c.visitor_id = :visitorId', { visitorId: filters.visitorId });
      if (filters.from) qb.andWhere('c.created_at >= :from', { from: filters.from });
      if (filters.to) qb.andWhere('c.created_at <= :to', { to: filters.to });
      return qb;
    };

    const baseQb = () =>
      applyFilters(
        this.convRepo.createQueryBuilder('c').where('c.tenant_id = :tenantId', { tenantId }),
      );

    const total = await baseQb().getCount();

    // TypeORM crashes when leftJoinAndMapOne (raw table) is combined with skip/take
    // because its internal pagination subquery can't resolve the joined alias metadata.
    // Workaround: paginate with a plain ID query, then load full rows + join by ID.
    const rawIds = await baseQb()
      .select('c.id', 'id')
      .orderBy('c.created_at', 'DESC')
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit)
      .getRawMany<{ id: string }>();

    if (rawIds.length === 0) return [[], total];

    const ids = rawIds.map((r) => r.id);
    const items = await this.convRepo
      .createQueryBuilder('c')
      .leftJoinAndMapOne('c.lead', 'leads', 'l', 'l.conversation_id = c.id AND l.tenant_id = :tenantId', { tenantId })
      .where('c.id IN (:...ids)', { ids, tenantId })
      .orderBy('c.created_at', 'DESC')
      .getMany();

    return [items, total];
  }

  // ─── Stage & Status ───────────────────────────────────────────────────────

  /**
   * Update the conversation stage.
   * Called by AgentOrchestratorService after a stage transition is validated.
   */
  async updateStage(
    id: string,
    tenantId: string,
    stage: ConversationStage,
  ): Promise<void> {
    await this.convRepo.update({ id, tenantId }, { currentStage: stage });
  }

  /**
   * Mark conversation as ENDED and record the end timestamp.
   * Idempotent — if already ended, returns the existing record.
   */
  async end(id: string, tenantId: string): Promise<Conversation> {
    const conv = await this.findById(id, tenantId);

    if (conv.status === ConversationStatus.ENDED) {
      return conv;
    }

    conv.status = ConversationStatus.ENDED;
    conv.endedAt = new Date();
    return this.convRepo.save(conv);
  }

  /**
   * Admin patch — allows closing or annotating a conversation.
   * Does NOT allow re-activating a conversation from ENDED status.
   */
  async patch(
    id: string,
    tenantId: string,
    patch: PatchConversationOptions,
  ): Promise<Conversation> {
    const conv = await this.findById(id, tenantId);

    if (patch.status === ConversationStatus.ACTIVE && conv.status !== ConversationStatus.ACTIVE) {
      throw new BadRequestException('Cannot re-activate a non-active conversation');
    }

    Object.assign(conv, patch);
    return this.convRepo.save(conv);
  }

  // ─── Counters (called by orchestrator after each turn) ───────────────────

  async incrementMessageCount(
    id: string,
    tenantId: string,
    tokensDelta: number,
  ): Promise<void> {
    await this.convRepo
      .createQueryBuilder()
      .update(Conversation)
      .set({
        messageCount: () => 'message_count + 1',
        totalTokens: () => `total_tokens + ${tokensDelta}`,
        lastMessageAt: new Date(),
      })
      .where('id = :id AND tenant_id = :tenantId', { id, tenantId })
      .execute();
  }

  // ─── Session state ────────────────────────────────────────────────────────

  /**
   * Returns the live AgentState for this conversation.
   * Null if the agent has not yet processed any message in this conversation.
   */
  async getSessionState(conversationId: string, tenantId: string): Promise<AgentState | null> {
    // Ensure conversation belongs to tenant before exposing agent state
    await this.findById(conversationId, tenantId);
    return this.stateRepo.findOne({ where: { conversationId, tenantId } });
  }

  // ─── Lead summary ─────────────────────────────────────────────────────────

  /**
   * Returns the Lead record associated with this conversation, if captured.
   * Null until CaptureContact skill fires.
   */
  async getLeadSummary(conversationId: string, tenantId: string): Promise<Lead | null> {
    await this.findById(conversationId, tenantId);
    return this.leadRepo.findOne({ where: { conversationId, tenantId } });
  }
}
