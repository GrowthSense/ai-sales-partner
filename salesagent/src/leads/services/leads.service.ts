import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Lead } from '../entities/lead.entity';
import { LeadActivity } from '../entities/lead-activity.entity';
import {
  LeadStatus,
  LeadSource,
  LeadActivityType,
} from '../../common/enums';
import { BantQualification } from '../entities/lead.entity';
import { QUEUE_NAMES } from '../../common/types/queue-jobs.types';

export interface UpsertLeadDto {
  tenantId: string;
  conversationId: string;
  visitorId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  qualificationPatch?: Partial<BantQualification>;
}

/**
 * LeadsService
 *
 * Manages the Lead lifecycle from anonymous visitor to qualified prospect.
 * All state changes produce an append-only LeadActivity record for audit/timeline.
 *
 * Lead creation is idempotent per conversationId (unique constraint).
 * Subsequent calls to upsertByConversation merge partial data.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,

    @InjectRepository(LeadActivity)
    private readonly activityRepo: Repository<LeadActivity>,

    @InjectQueue(QUEUE_NAMES.CRM_SYNC)
    private readonly crmQueue: Queue,
  ) {}

  // ─── Core upsert ─────────────────────────────────────────────────────────

  /**
   * Create-or-update the Lead record for a conversation.
   *
   * Called by CaptureContact and QualifyLead skills with partial data.
   * Merges qualificationData JSONB rather than overwriting it.
   * Recomputes the BANT score after every update.
   */
  async upsertByConversation(dto: UpsertLeadDto): Promise<Lead> {
    let lead = await this.leadRepo.findOne({
      where: { conversationId: dto.conversationId, tenantId: dto.tenantId },
    });

    const isNew = !lead;

    if (isNew) {
      lead = this.leadRepo.create({
        tenantId: dto.tenantId,
        conversationId: dto.conversationId,
        visitorId: dto.visitorId,
        source: LeadSource.WEBSITE_CHAT,
        status: LeadStatus.NEW,
        qualificationData: {
          budget: null,
          hasBudget: null,
          authority: null,
          isDecisionMaker: null,
          need: null,
          needStrength: null,
          timeline: null,
          hasTimeline: null,
          notes: null,
        },
      });
    }

    // Merge contact fields (never overwrite with null if we already have data)
    if (dto.firstName) lead!.firstName = dto.firstName;
    if (dto.lastName) lead!.lastName = dto.lastName;
    if (dto.email) lead!.email = dto.email;
    if (dto.phone) lead!.phone = dto.phone;
    if (dto.company) lead!.company = dto.company;
    if (dto.jobTitle) lead!.jobTitle = dto.jobTitle;

    // Merge BANT qualification (partial patch)
    if (dto.qualificationPatch) {
      lead!.qualificationData = {
        ...lead!.qualificationData,
        ...Object.fromEntries(
          Object.entries(dto.qualificationPatch).filter(([, v]) => v !== undefined),
        ),
      } as BantQualification;
    }

    // Recompute BANT score
    lead!.score = this.computeScore(lead!);

    // Auto-promote status based on data completeness
    if (lead!.status === LeadStatus.NEW && (lead!.email || lead!.phone)) {
      lead!.status = LeadStatus.CONTACTED;
    }
    if (lead!.score >= 50 && lead!.status === LeadStatus.CONTACTED) {
      lead!.status = LeadStatus.QUALIFIED;
    }

    const saved = await this.leadRepo.save(lead!);

    // Append activity record
    await this.activityRepo.save(
      this.activityRepo.create({
        tenantId: dto.tenantId,
        leadId: saved.id,
        type: isNew ? LeadActivityType.CREATED : LeadActivityType.STAGE_CHANGED,
        description: isNew ? 'Lead created from conversation' : 'Lead data updated',
        actorType: 'agent',
        metadata: { conversationId: dto.conversationId },
      }),
    );

    this.logger.debug(
      `Lead ${isNew ? 'created' : 'updated'}: ${saved.id} score=${saved.score} status=${saved.status}`,
    );

    return saved;
  }

  // ─── BANT scoring ─────────────────────────────────────────────────────────

  /**
   * Compute a 0–100 BANT qualification score.
   *
   *  Budget:    25 pts (hasBudget=true: 15, budget text present: +10)
   *  Authority: 25 pts (isDecisionMaker=true: 15, authority text: +10)
   *  Need:      25 pts (needStrength: low=5, medium=15, high=25)
   *  Timeline:  25 pts (hasTimeline=true: 15, timeline text: +10)
   */
  computeScore(lead: Lead): number {
    const qd = lead.qualificationData;
    if (!qd) return 0;

    let score = 0;

    // Budget (25)
    if (qd.hasBudget === true) score += 15;
    if (qd.budget) score += 10;

    // Authority (25)
    if (qd.isDecisionMaker === true) score += 15;
    if (qd.authority) score += 10;

    // Need (25)
    if (qd.needStrength === 'high') score += 25;
    else if (qd.needStrength === 'medium') score += 15;
    else if (qd.needStrength === 'low') score += 5;
    else if (qd.need) score += 5; // has description but no strength rating

    // Timeline (25)
    if (qd.hasTimeline === true) score += 15;
    if (qd.timeline) score += 10;

    return Math.min(score, 100);
  }

  // ─── Read operations ──────────────────────────────────────────────────────

  async findById(id: string, tenantId: string): Promise<Lead | null> {
    return this.leadRepo.findOne({ where: { id, tenantId } });
  }

  async findByConversation(conversationId: string, tenantId: string): Promise<Lead | null> {
    return this.leadRepo.findOne({ where: { conversationId, tenantId } });
  }

  async findAll(
    tenantId: string,
    filters: { status?: LeadStatus; minScore?: number } = {},
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ): Promise<[Lead[], number]> {
    const qb = this.leadRepo
      .createQueryBuilder('lead')
      .where('lead.tenant_id = :tenantId', { tenantId })
      .orderBy('lead.created_at', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);

    if (filters.status) {
      qb.andWhere('lead.status = :status', { status: filters.status });
    }
    if (filters.minScore !== undefined) {
      qb.andWhere('lead.score >= :minScore', { minScore: filters.minScore });
    }

    return qb.getManyAndCount();
  }

  // ─── Status management ────────────────────────────────────────────────────

  async updateStatus(id: string, tenantId: string, newStatus: LeadStatus): Promise<Lead> {
    const lead = await this.leadRepo.findOneOrFail({ where: { id, tenantId } });
    const previousStatus = lead.status;

    lead.status = newStatus;
    const saved = await this.leadRepo.save(lead);

    await this.activityRepo.save(
      this.activityRepo.create({
        tenantId,
        leadId: id,
        type: LeadActivityType.STAGE_CHANGED,
        description: `Status changed: ${previousStatus} → ${newStatus}`,
        previousStatus,
        newStatus,
        actorType: 'agent',
        metadata: {},
      }),
    );

    return saved;
  }

  // ─── CRM sync ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a CRM sync job. Fire-and-forget — the worker handles retries.
   */
  async enqueueCrmSync(leadId: string, tenantId: string): Promise<void> {
    await this.crmQueue.add(
      'crm-sync',
      { leadId, tenantId },
      { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    );
    this.logger.debug(`CRM sync enqueued for lead ${leadId}`);
  }
}
