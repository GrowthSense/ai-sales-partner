import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { WorkflowService } from './workflow.service';
import { WorkflowExecution } from '../entities/workflow-execution.entity';
import { WorkflowTrigger } from '../interfaces/workflow-step.interface';
import { FollowUpJob, QUEUE_NAMES, RETRY_CONFIGS } from '../../common/types/queue-jobs.types';

const HOURS_TO_MS = 3_600_000;

/**
 * WorkflowTriggerService — the engine that starts and advances workflow executions.
 *
 * ─── Entry points ────────────────────────────────────────────────────────────
 *
 * evaluate(conversationId, trigger, tenantId, leadId)
 *   Called by AgentOrchestratorService after conversation events.
 *   Finds all active workflows for the tenant with the matching trigger and
 *   starts a WorkflowExecution for each one.
 *
 * advanceExecution(executionId, nextStepIndex, tenantId)
 *   Called by FollowUpWorker after a step completes.
 *   Enqueues the next step with the appropriate delay.
 *
 * ─── Execution lifecycle ─────────────────────────────────────────────────────
 *
 *   evaluate()
 *     → create WorkflowExecution (status: running, currentStep: 0)
 *     → enqueue FollowUpJob(stepIndex: 0, delay: step[0].delayHours)
 *
 *   FollowUpWorker.process(stepIndex: N)
 *     → execute step N
 *     → append to execution.logs
 *     → if step N has delayHours: wait is already baked into job delay
 *     → if more steps: advanceExecution(N+1) → enqueue next job
 *     → if last step: markComplete()
 *
 * ─── WAIT steps ──────────────────────────────────────────────────────────────
 *   A WAIT step is a no-op in the worker but carries delayHours that is
 *   used as the BullMQ job delay for the FOLLOWING step. This way the worker
 *   is never blocked and the delay is handled by Redis.
 */
@Injectable()
export class WorkflowTriggerService {
  private readonly logger = new Logger(WorkflowTriggerService.name);

  constructor(
    private readonly workflowService: WorkflowService,

    @InjectRepository(WorkflowExecution)
    private readonly executionRepo: Repository<WorkflowExecution>,

    @InjectQueue(QUEUE_NAMES.FOLLOW_UP)
    private readonly followUpQueue: Queue<FollowUpJob>,
  ) {}

  /**
   * Evaluate trigger conditions and start executions for all matching workflows.
   *
   * @param trigger     The event that occurred (e.g. CONVERSATION_ENDED)
   * @param tenantId    Tenant scope
   * @param leadId      The lead the event is associated with
   */
  async evaluate(
    trigger: WorkflowTrigger,
    tenantId: string,
    leadId: string,
  ): Promise<void> {
    const workflows = await this.workflowService.findByTrigger(tenantId, trigger);

    if (workflows.length === 0) {
      this.logger.debug(`No active workflows for trigger=${trigger} tenantId=${tenantId}`);
      return;
    }

    this.logger.log(
      `Evaluating ${workflows.length} workflow(s) for trigger=${trigger} ` +
      `leadId=${leadId} tenantId=${tenantId}`,
    );

    // Start each matching workflow concurrently
    await Promise.all(
      workflows.map((workflow) =>
        this.startExecution(workflow.id, leadId, tenantId, workflow.steps),
      ),
    );
  }

  /**
   * Create a WorkflowExecution and enqueue the first step.
   */
  async startExecution(
    workflowId: string,
    leadId: string,
    tenantId: string,
    steps: { delayHours?: number }[],
  ): Promise<WorkflowExecution> {
    const execution = await this.executionRepo.save(
      this.executionRepo.create({
        tenantId,
        workflowId,
        leadId,
        status: 'running',
        currentStep: 0,
        logs: [],
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      }),
    );

    // Enqueue step 0 — delay based on the first step's delayHours
    const delayMs = (steps[0]?.delayHours ?? 0) * HOURS_TO_MS;
    await this.enqueueStep(execution.id, workflowId, leadId, tenantId, 0, delayMs);

    this.logger.log(
      `Workflow execution started: executionId=${execution.id} workflowId=${workflowId} ` +
      `leadId=${leadId} firstDelay=${delayMs}ms`,
    );

    return execution;
  }

  /**
   * Enqueue the next step after the current one completes.
   * Called by FollowUpWorker to hand off to the next step.
   *
   * @param delayMs  Delay before the next step runs (from the completed step's delayHours)
   */
  async advanceExecution(
    executionId: string,
    workflowId: string,
    leadId: string,
    tenantId: string,
    nextStepIndex: number,
    delayMs: number,
  ): Promise<void> {
    await this.executionRepo.update(executionId, { currentStep: nextStepIndex });
    await this.enqueueStep(executionId, workflowId, leadId, tenantId, nextStepIndex, delayMs);

    this.logger.debug(
      `Workflow execution advanced: executionId=${executionId} ` +
      `nextStep=${nextStepIndex} delay=${delayMs}ms`,
    );
  }

  /**
   * Mark an execution as completed (called by FollowUpWorker after the last step).
   */
  async markComplete(executionId: string): Promise<void> {
    await this.executionRepo.update(executionId, {
      status: 'completed',
      completedAt: new Date(),
    });
    this.logger.log(`Workflow execution completed: executionId=${executionId}`);
  }

  /**
   * Mark an execution as failed (called by FollowUpWorker on unrecoverable error).
   */
  async markFailed(executionId: string, errorMessage: string): Promise<void> {
    await this.executionRepo.update(executionId, {
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    });
    this.logger.warn(`Workflow execution failed: executionId=${executionId} error=${errorMessage}`);
  }

  /**
   * Append a log entry for a completed step.
   * Uses a raw UPDATE to atomically append to the JSONB array.
   */
  async appendLog(
    executionId: string,
    log: {
      stepIndex: number;
      stepType: string;
      startedAt: string;
      completedAt: string;
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<void> {
    await this.executionRepo
      .createQueryBuilder()
      .update()
      .set({
        logs: () => `logs || '${JSON.stringify(log)}'::jsonb`,
      })
      .where('id = :id', { id: executionId })
      .execute();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async enqueueStep(
    executionId: string,
    workflowId: string,
    leadId: string,
    tenantId: string,
    stepIndex: number,
    delayMs: number,
  ): Promise<void> {
    await this.followUpQueue.add(
      `step-${stepIndex}`,
      { tenantId, leadId, workflowId, executionId, stepIndex },
      {
        ...RETRY_CONFIGS.LENIENT,
        delay: delayMs,
        jobId: `${executionId}:step:${stepIndex}`, // deduplication key
      },
    );
  }
}
