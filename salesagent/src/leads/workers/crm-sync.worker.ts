import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';

import { CrmSyncJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';
import { CrmIntegrationService } from '../../integrations/services/crm-integration.service';
import { Lead } from '../entities/lead.entity';
import { LeadActivity } from '../entities/lead-activity.entity';
import { WorkflowJob } from '../../workflows/entities/workflow-job.entity';
import { LeadActivityType, WorkflowJobStatus } from '../../common/enums';
import { LeadPayload } from '../../integrations/interfaces/crm-adapter.interface';

/**
 * CrmSyncWorker — BullMQ processor for the 'crm-sync' queue.
 *
 * Consumes CrmSyncJob { tenantId, leadId } and pushes the lead to the
 * tenant's configured CRM (HubSpot or Salesforce). Idempotent: the CRM
 * adapter checks for an existing contact by email before creating.
 *
 * Retry policy:
 *   - 5 attempts with exponential backoff starting at 5s
 *   - All errors are retryable (network, rate limits, transient API failures)
 *   - No permanent-error distinction: if all 5 attempts fail, the job goes
 *     to BullMQ failed state and the WorkflowJob DB record is marked FAILED
 *
 * Dead-letter handling:
 *   - No separate DLQ — failed jobs remain in BullMQ 'failed' set for 1000 jobs
 *   - WorkflowJob DB record provides human-readable audit trail + manual retry
 *   - Admins see failures in the dashboard and can trigger POST /leads/:id/sync-crm
 *
 * Concurrency: 3 per worker instance (CRM APIs have rate limits)
 */
@Processor(QUEUE_NAMES.CRM_SYNC, { concurrency: 3 })
export class CrmSyncWorker extends WorkerHost {
  private readonly logger = new Logger(CrmSyncWorker.name);

  constructor(
    private readonly crm: CrmIntegrationService,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,

    @InjectRepository(LeadActivity)
    private readonly activityRepo: Repository<LeadActivity>,

    @InjectRepository(WorkflowJob)
    private readonly workflowJobRepo: Repository<WorkflowJob>,
  ) {
    super();
  }

  async process(job: Job<CrmSyncJob>): Promise<void> {
    const { leadId, tenantId } = job.data;

    this.logger.log(
      `CRM sync: leadId=${leadId} attempt=${job.attemptsMade + 1}`,
    );

    // Mark the WorkflowJob as RUNNING on first attempt
    await this.workflowJobRepo.update(
      { referenceId: leadId, tenantId, queueName: QUEUE_NAMES.CRM_SYNC },
      {
        status: WorkflowJobStatus.RUNNING,
        bullmqJobId: job.id ?? null,
        attemptCount: job.attemptsMade + 1,
        startedAt: new Date(),
      },
    );

    // Load the lead
    const lead = await this.leadRepo.findOne({ where: { id: leadId, tenantId } });
    if (!lead) {
      this.logger.warn(`Lead ${leadId} not found for tenant ${tenantId} — skipping CRM sync`);
      await this.markWorkflowJobFailed(leadId, tenantId, 'Lead not found');
      return; // Non-retriable — lead was deleted
    }

    const payload: LeadPayload = {
      email: lead.email ?? undefined,
      firstName: lead.firstName ?? undefined,
      lastName: lead.lastName ?? undefined,
      phone: lead.phone ?? undefined,
      company: lead.company ?? undefined,
      jobTitle: lead.jobTitle ?? undefined,
      score: lead.score,
      status: lead.status,
      notes: lead.qualificationData?.notes ?? undefined,
    };

    // Push to CRM — throws on failure (BullMQ retries)
    const result = await this.crm.push(tenantId, payload);

    // Persist CRM ID and sync timestamp
    await this.leadRepo.update(leadId, {
      crmId: result.crmId,
      crmSyncedAt: new Date(),
    });

    // Append activity record for audit trail
    await this.activityRepo.save(
      this.activityRepo.create({
        tenantId,
        leadId,
        type: LeadActivityType.CRM_SYNCED,
        description: `CRM sync completed: provider=${result.provider} crmId=${result.crmId} new=${result.isNew}`,
        actorType: 'system',
        metadata: { provider: result.provider, crmId: result.crmId, isNew: result.isNew },
      }),
    );

    // Mark WorkflowJob completed
    await this.workflowJobRepo.update(
      { referenceId: leadId, tenantId, queueName: QUEUE_NAMES.CRM_SYNC },
      {
        status: WorkflowJobStatus.COMPLETED,
        result: { success: true, data: result } as any,
        completedAt: new Date(),
      },
    );

    this.logger.log(
      `CRM sync complete: leadId=${leadId} provider=${result.provider} ` +
      `crmId=${result.crmId} isNew=${result.isNew}`,
    );
  }

  // ─── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CrmSyncJob>): void {
    this.logger.log(
      `Job completed: id=${job.id} leadId=${job.data.leadId} ` +
      `latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<CrmSyncJob> | undefined, err: Error): Promise<void> {
    this.logger.error(
      `Job failed: id=${job?.id} leadId=${job?.data.leadId} ` +
      `attempts=${job?.attemptsMade}: ${err.message}`,
    );

    if (job && job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
      // All retries exhausted — move WorkflowJob to dead-letter state
      await this.markWorkflowJobFailed(job.data.leadId, job.data.tenantId, err.message);
    } else {
      // Still retrying — update attempt count
      await this.workflowJobRepo.update(
        { referenceId: job?.data.leadId, tenantId: job?.data.tenantId, queueName: QUEUE_NAMES.CRM_SYNC },
        {
          status: WorkflowJobStatus.RETRYING,
          errorMessage: err.message,
          attemptCount: (job?.attemptsMade ?? 0) + 1,
        },
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Job stalled: id=${jobId} — BullMQ will re-queue`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async markWorkflowJobFailed(leadId: string, tenantId: string, errorMessage: string): Promise<void> {
    await this.workflowJobRepo.update(
      { referenceId: leadId, tenantId, queueName: QUEUE_NAMES.CRM_SYNC },
      {
        status: WorkflowJobStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    );
  }
}
