import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';

import { FollowUpJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';
import { WorkflowTriggerService } from '../services/workflow-trigger.service';
import { WorkflowService } from '../services/workflow.service';
import { WorkflowExecution } from '../entities/workflow-execution.entity';
import { WorkflowStepType } from '../interfaces/workflow-step.interface';
import { EmailIntegrationService } from '../../integrations/services/email-integration.service';
import { CrmIntegrationService } from '../../integrations/services/crm-integration.service';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadStatus } from '../../common/enums';

const HOURS_TO_MS = 3_600_000;

/**
 * FollowUpWorker — BullMQ processor for the 'follow-up' queue.
 *
 * Executes one workflow step per job invocation. After each step it either:
 *   - Enqueues the next step (via WorkflowTriggerService.advanceExecution)
 *   - Or marks the execution complete if this was the last step
 *
 * ─── Step types ──────────────────────────────────────────────────────────────
 *
 *   SEND_EMAIL
 *     config: { to?, subject, body, templateId? }
 *     Uses EmailIntegrationService. Falls back to lead.email if 'to' not set.
 *
 *   UPDATE_LEAD_STAGE
 *     config: { status: LeadStatus }
 *     Updates lead.status directly.
 *
 *   PUSH_TO_CRM
 *     config: {}
 *     Pushes current lead data to CRM via CrmIntegrationService.
 *
 *   WAIT
 *     No-op — the delay is applied to the NEXT job via BullMQ delayed jobs.
 *     This step records the wait in logs and immediately advances.
 *
 * ─── Retry policy ────────────────────────────────────────────────────────────
 *   - 4 attempts, exponential backoff from 30s
 *   - Transient errors (email timeout, CRM 503) → retry
 *   - Permanent errors (lead deleted, workflow deleted) → mark failed, no retry
 *
 * Concurrency: 5
 */
@Processor(QUEUE_NAMES.FOLLOW_UP, { concurrency: 5 })
export class FollowUpWorker extends WorkerHost {
  private readonly logger = new Logger(FollowUpWorker.name);

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly triggerService: WorkflowTriggerService,
    private readonly emailIntegration: EmailIntegrationService,
    private readonly crmIntegration: CrmIntegrationService,

    @InjectRepository(WorkflowExecution)
    private readonly executionRepo: Repository<WorkflowExecution>,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
  ) {
    super();
  }

  async process(job: Job<FollowUpJob>): Promise<void> {
    const { tenantId, leadId, workflowId, executionId, stepIndex } = job.data;

    this.logger.log(
      `Follow-up step: executionId=${executionId} step=${stepIndex} attempt=${job.attemptsMade + 1}`,
    );

    // Load the execution — abort if cancelled/completed (idempotency)
    const execution = await this.executionRepo.findOne({ where: { id: executionId, tenantId } });
    if (!execution || execution.status === 'completed' || execution.status === 'cancelled') {
      this.logger.warn(
        `Execution ${executionId} is ${execution?.status ?? 'not found'} — skipping step ${stepIndex}`,
      );
      return;
    }

    // Load the workflow definition
    const workflow = await this.workflowService.findById(workflowId, tenantId);
    const step = workflow.steps[stepIndex];

    if (!step) {
      // Step index out of range — mark complete
      this.logger.warn(`Step ${stepIndex} not found in workflow ${workflowId} — marking complete`);
      await this.triggerService.markComplete(executionId);
      return;
    }

    const stepStartedAt = new Date().toISOString();
    let stepResult: Record<string, unknown> | undefined;
    let stepError: string | undefined;
    let permanent = false;

    try {
      stepResult = await this.executeStep(step, leadId, tenantId);
    } catch (err: unknown) {
      stepError = err instanceof Error ? err.message : String(err);
      permanent = (err as { isPermanent?: boolean }).isPermanent === true;

      if (permanent) {
        // Non-retriable — mark execution failed and return without throwing
        await this.triggerService.appendLog(executionId, {
          stepIndex,
          stepType: step.type,
          startedAt: stepStartedAt,
          completedAt: new Date().toISOString(),
          success: false,
          error: stepError,
        });
        await this.triggerService.markFailed(executionId, stepError);
        return;
      }

      // Transient error — let BullMQ retry (throw propagates)
      await this.triggerService.appendLog(executionId, {
        stepIndex,
        stepType: step.type,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString(),
        success: false,
        error: `Attempt ${job.attemptsMade + 1} failed: ${stepError}`,
      });
      throw err;
    }

    // Step succeeded — append log
    await this.triggerService.appendLog(executionId, {
      stepIndex,
      stepType: step.type,
      startedAt: stepStartedAt,
      completedAt: new Date().toISOString(),
      success: true,
      result: stepResult,
    });

    // Determine next step
    const nextStepIndex = stepIndex + 1;
    const isLastStep = nextStepIndex >= workflow.steps.length;

    if (isLastStep) {
      await this.triggerService.markComplete(executionId);
    } else {
      // Delay for the next step = current step's delayHours (WAIT pattern)
      // OR the next step's delayHours if the next step itself is a WAIT
      const nextStep = workflow.steps[nextStepIndex];
      const delayMs = (nextStep?.delayHours ?? 0) * HOURS_TO_MS;
      await this.triggerService.advanceExecution(
        executionId,
        workflowId,
        leadId,
        tenantId,
        nextStepIndex,
        delayMs,
      );
    }
  }

  // ─── Step execution dispatch ─────────────────────────────────────────────

  private async executeStep(
    step: { type: WorkflowStepType; config: Record<string, unknown>; delayHours?: number },
    leadId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    switch (step.type) {
      case WorkflowStepType.WAIT:
        // WAIT is a no-op — the delay is applied to the next job's BullMQ delay
        return { waited: true, delayHours: step.delayHours ?? 0 };

      case WorkflowStepType.SEND_EMAIL:
        return this.stepSendEmail(step.config, leadId, tenantId);

      case WorkflowStepType.UPDATE_LEAD_STAGE:
        return this.stepUpdateLeadStage(step.config, leadId, tenantId);

      case WorkflowStepType.PUSH_TO_CRM:
        return this.stepPushToCrm(leadId, tenantId);

      default: {
        const err = new Error(`Unknown step type: ${step.type as string}`);
        (err as { isPermanent?: boolean }).isPermanent = true;
        throw err;
      }
    }
  }

  private async stepSendEmail(
    config: Record<string, unknown>,
    leadId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const lead = await this.requireLead(leadId, tenantId);

    const to = (config['to'] as string | undefined) ?? lead.email;
    if (!to) {
      const err = new Error(`No email address for lead ${leadId}`);
      (err as { isPermanent?: boolean }).isPermanent = true;
      throw err;
    }

    const messageId = await this.emailIntegration.send(tenantId, {
      to,
      subject: (config['subject'] as string | undefined) ?? 'Following up from our conversation',
      html: (config['body'] as string | undefined) ?? '',
    });

    return { messageId, to };
  }

  private async stepUpdateLeadStage(
    config: Record<string, unknown>,
    leadId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const lead = await this.requireLead(leadId, tenantId);
    const newStatus = config['status'] as LeadStatus | undefined;

    if (!newStatus || !Object.values(LeadStatus).includes(newStatus)) {
      const err = new Error(`Invalid lead status in workflow step: ${String(newStatus)}`);
      (err as { isPermanent?: boolean }).isPermanent = true;
      throw err;
    }

    const previousStatus = lead.status;
    await this.leadRepo.update({ id: leadId, tenantId }, { status: newStatus });

    return { previousStatus, newStatus };
  }

  private async stepPushToCrm(
    leadId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const lead = await this.requireLead(leadId, tenantId);

    const result = await this.crmIntegration.push(tenantId, {
      email: lead.email ?? undefined,
      firstName: lead.firstName ?? undefined,
      lastName: lead.lastName ?? undefined,
      phone: lead.phone ?? undefined,
      company: lead.company ?? undefined,
      jobTitle: lead.jobTitle ?? undefined,
      score: lead.score,
      status: lead.status,
    });

    await this.leadRepo.update({ id: leadId, tenantId }, {
      crmId: result.crmId,
      crmSyncedAt: new Date(),
    });

    return { crmId: result.crmId, provider: result.provider };
  }

  private async requireLead(leadId: string, tenantId: string): Promise<Lead> {
    const lead = await this.leadRepo.findOne({ where: { id: leadId, tenantId } });
    if (!lead) {
      const err = new Error(`Lead ${leadId} not found for tenant ${tenantId}`);
      (err as { isPermanent?: boolean }).isPermanent = true;
      throw err;
    }
    return lead;
  }

  // ─── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<FollowUpJob>): void {
    this.logger.log(
      `Step completed: executionId=${job.data.executionId} step=${job.data.stepIndex} ` +
      `latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<FollowUpJob> | undefined, err: Error): void {
    this.logger.error(
      `Step failed: executionId=${job?.data.executionId} step=${job?.data.stepIndex} ` +
      `attempts=${job?.attemptsMade}: ${err.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Follow-up job stalled: id=${jobId} — BullMQ will re-queue`);
  }
}
