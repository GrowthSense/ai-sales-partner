import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';

import { NotificationJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';
import { WebhookProvider } from '../webhooks/webhook.provider';
import { WorkflowJob } from '../../workflows/entities/workflow-job.entity';
import { WorkflowJobStatus } from '../../common/enums';

/**
 * NotificationsWorker — BullMQ processor for the 'notifications' queue.
 *
 * Reliably delivers event webhook payloads to tenant-configured endpoints.
 * The WebhookProvider performs the actual HTTP POST; this worker handles
 * retry scheduling and dead-letter tracking.
 *
 * Why a queue for webhooks?
 *   - Tenant webhooks may be slow or temporarily unreachable
 *   - Blocking the agent reasoning loop for webhook delivery degrades UX
 *   - Guaranteed delivery via retry + observability via WorkflowJob records
 *
 * Retry policy:
 *   - 5 attempts, exponential backoff from 10s
 *   - Any non-delivery (HTTP 4xx/5xx, timeout, network error) triggers retry
 *   - Exception: HTTP 410 Gone → permanent failure, do not retry
 *
 * Dead-letter:
 *   - After 5 failures, WorkflowJob.status = FAILED
 *   - Admin can inspect and replay via POST /integrations/webhook/replay
 *
 * Concurrency: 10 — webhook POSTs are I/O-bound, high concurrency is fine
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS, { concurrency: 10 })
export class NotificationsWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationsWorker.name);

  constructor(
    private readonly webhookProvider: WebhookProvider,

    @InjectRepository(WorkflowJob)
    private readonly workflowJobRepo: Repository<WorkflowJob>,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const { tenantId, event, payload, idempotencyKey } = job.data;

    this.logger.debug(
      `Webhook delivery: tenantId=${tenantId} event=${event} ` +
      `attempt=${job.attemptsMade + 1} idempotencyKey=${idempotencyKey ?? 'none'}`,
    );

    // Mark as RUNNING on first attempt
    if (job.attemptsMade === 0) {
      await this.workflowJobRepo.update(
        {
          tenantId,
          queueName: QUEUE_NAMES.NOTIFICATIONS,
          bullmqJobId: job.id ?? undefined,
        },
        { status: WorkflowJobStatus.RUNNING, startedAt: new Date() },
      );
    }

    const delivered = await this.webhookProvider.deliver(tenantId, {
      event,
      tenantId,
      data: payload,
      timestamp: new Date().toISOString(),
    });

    if (!delivered) {
      // WebhookProvider returned false → no endpoint configured or HTTP failure.
      // Throw so BullMQ retries (the provider logs the specific reason).
      throw new Error(`Webhook delivery failed for event=${event} tenantId=${tenantId}`);
    }

    // Mark completed
    await this.workflowJobRepo.update(
      { tenantId, queueName: QUEUE_NAMES.NOTIFICATIONS, bullmqJobId: job.id ?? undefined },
      {
        status: WorkflowJobStatus.COMPLETED,
        result: { success: true, data: { event } },
        completedAt: new Date(),
      },
    );
  }

  // ─── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<NotificationJob>): void {
    this.logger.debug(
      `Webhook delivered: id=${job.id} event=${job.data.event} ` +
      `tenantId=${job.data.tenantId} latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJob> | undefined, err: Error): Promise<void> {
    this.logger.warn(
      `Webhook delivery failed: id=${job?.id} event=${job?.data.event} ` +
      `tenantId=${job?.data.tenantId} attempts=${job?.attemptsMade}: ${err.message}`,
    );

    const isExhausted = job && job.attemptsMade >= (job.opts.attempts ?? 5) - 1;

    if (isExhausted) {
      await this.workflowJobRepo.update(
        { tenantId: job?.data.tenantId, queueName: QUEUE_NAMES.NOTIFICATIONS, bullmqJobId: job?.id ?? undefined },
        {
          status: WorkflowJobStatus.FAILED,
          errorMessage: err.message,
          completedAt: new Date(),
        },
      );
      this.logger.error(
        `Webhook permanently failed after all retries: event=${job?.data.event} ` +
        `tenantId=${job?.data.tenantId}`,
      );
    } else {
      await this.workflowJobRepo.update(
        { tenantId: job?.data.tenantId, queueName: QUEUE_NAMES.NOTIFICATIONS, bullmqJobId: job?.id ?? undefined },
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
    this.logger.warn(`Webhook job stalled: id=${jobId} — BullMQ will re-queue`);
  }
}
