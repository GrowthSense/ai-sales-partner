import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Lead } from '../entities/lead.entity';
import { LeadActivity } from '../entities/lead-activity.entity';
import { LeadStatus, LeadActivityType } from '../../common/enums';
import { ListLeadsDto } from '../dtos/list-leads.dto';
import { UpdateLeadDto } from '../dtos/update-lead.dto';
import { QUEUE_NAMES } from '../../common/types/queue-jobs.types';

/**
 * LeadsAdminService
 *
 * Admin-facing read/update/CRM-sync operations on Lead records.
 * Separate from LeadsService in AgentsModule (which is the write path
 * called by skills during conversations).
 *
 * Uses the same Lead/LeadActivity repositories but is registered in
 * LeadsModule so it does not create a circular dependency with AgentsModule.
 */
@Injectable()
export class LeadsAdminService {
  private readonly logger = new Logger(LeadsAdminService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,

    @InjectRepository(LeadActivity)
    private readonly activityRepo: Repository<LeadActivity>,

    @InjectQueue(QUEUE_NAMES.CRM_SYNC)
    private readonly crmQueue: Queue,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    dto: ListLeadsDto,
  ): Promise<[Lead[], number]> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const qb = this.leadRepo
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .orderBy('l.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (dto.status) qb.andWhere('l.status = :status', { status: dto.status });
    if (dto.email) qb.andWhere('l.email ILIKE :email', { email: `%${dto.email}%` });
    if (dto.company) qb.andWhere('l.company ILIKE :company', { company: `%${dto.company}%` });
    if (dto.minScore !== undefined) qb.andWhere('l.score >= :minScore', { minScore: dto.minScore });
    if (dto.maxScore !== undefined) qb.andWhere('l.score <= :maxScore', { maxScore: dto.maxScore });
    if (dto.from) qb.andWhere('l.created_at >= :from', { from: new Date(dto.from) });
    if (dto.to) qb.andWhere('l.created_at <= :to', { to: new Date(dto.to) });

    return qb.getManyAndCount();
  }

  // ─── Get ──────────────────────────────────────────────────────────────────

  async findById(id: string, tenantId: string): Promise<Lead> {
    const lead = await this.leadRepo.findOne({
      where: { id, tenantId },
      relations: ['activities', 'meetings'],
    });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  // ─── Admin update ─────────────────────────────────────────────────────────

  /**
   * Manual admin update — allows correcting contact info, score, or status.
   * Produces a LeadActivity record for audit.
   */
  async update(id: string, tenantId: string, dto: UpdateLeadDto): Promise<Lead> {
    const lead = await this.findById(id, tenantId);
    const changes: string[] = [];

    if (dto.firstName !== undefined) { lead.firstName = dto.firstName; changes.push('firstName'); }
    if (dto.lastName !== undefined) { lead.lastName = dto.lastName; changes.push('lastName'); }
    if (dto.email !== undefined) { lead.email = dto.email; changes.push('email'); }
    if (dto.phone !== undefined) { lead.phone = dto.phone; changes.push('phone'); }
    if (dto.company !== undefined) { lead.company = dto.company; changes.push('company'); }
    if (dto.jobTitle !== undefined) { lead.jobTitle = dto.jobTitle; changes.push('jobTitle'); }
    if (dto.score !== undefined) { lead.score = dto.score; changes.push('score'); }

    if (dto.status !== undefined && dto.status !== lead.status) {
      lead.status = dto.status;
      changes.push('status');

      const activity = this.activityRepo.create({
        tenantId,
        leadId: lead.id,
        type: LeadActivityType.STAGE_CHANGED,
        metadata: { from: lead.status, to: dto.status, source: 'admin' },
      });
      await this.activityRepo.save(activity);
    }

    if (dto.qualificationData) {
      lead.qualificationData = { ...lead.qualificationData, ...dto.qualificationData };
      changes.push('qualificationData');
    }

    const saved = await this.leadRepo.save(lead);
    this.logger.log(`Lead ${id} updated by admin: changed=${changes.join(',')}`);
    return saved;
  }

  // ─── CRM sync ─────────────────────────────────────────────────────────────

  /**
   * Manually trigger a CRM sync for a lead.
   * Enqueues a crm-sync BullMQ job (same as automatic sync after capture).
   */
  async syncToCrm(id: string, tenantId: string): Promise<{ queued: boolean; jobId: string }> {
    const lead = await this.findById(id, tenantId);

    const job = await this.crmQueue.add(
      'crm-sync',
      { tenantId, leadId: lead.id, crmType: 'hubspot' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`CRM sync queued: leadId=${id} jobId=${job.id}`);
    return { queued: true, jobId: String(job.id) };
  }
}
