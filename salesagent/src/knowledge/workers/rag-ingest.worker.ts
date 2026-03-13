import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { IngestionService, PermanentIngestionError } from '../services/ingestion.service';
import { RagIngestJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';

/**
 * RagIngestWorker — BullMQ processor for the 'rag-ingest' queue.
 *
 * Consumes RagIngestJob { tenantId, documentId } and delegates to
 * IngestionService which runs the full parse → chunk → embed → store pipeline.
 *
 * Retry policy (set by DocumentService when enqueueing):
 *  - 3 attempts total
 *  - Exponential backoff: 10s, 20s, 40s
 *  - PermanentIngestionError → mark document failed, do NOT retry
 *  - Transient errors (OpenAI timeout, DB error) → retry
 *
 * Concurrency:
 *  - `concurrency: 3` — process 3 documents in parallel per worker instance
 *  - Scale by deploying more worker instances (stateless, DB-backed)
 */
@Processor(QUEUE_NAMES.RAG_INGEST, { concurrency: 3 })
export class RagIngestWorker extends WorkerHost {
  private readonly logger = new Logger(RagIngestWorker.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<RagIngestJob>): Promise<void> {
    const { documentId, tenantId } = job.data;

    this.logger.log(
      `Processing rag-ingest job: id=${job.id} documentId=${documentId} ` +
      `attempt=${job.attemptsMade + 1}`,
    );

    try {
      await this.ingestion.ingest(documentId, tenantId);
    } catch (err: unknown) {
      if (err instanceof PermanentIngestionError || (err as { isPermanent?: boolean }).isPermanent) {
        // Do NOT throw — returning normally prevents BullMQ from retrying.
        // IngestionService already called documentService.markFailed().
        this.logger.warn(
          `Permanent ingestion failure for document ${documentId}: ` +
          (err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      // Transient error — throw so BullMQ schedules a retry
      this.logger.error(
        `Transient ingestion failure for document ${documentId} ` +
        `(attempt ${job.attemptsMade + 1}): ` +
        (err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  }

  // ─── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<RagIngestJob>): void {
    this.logger.log(
      `Job completed: id=${job.id} documentId=${job.data.documentId} ` +
      `latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<RagIngestJob> | undefined, err: Error): void {
    this.logger.error(
      `Job failed: id=${job?.id} documentId=${job?.data.documentId} ` +
      `attempts=${job?.attemptsMade}: ${err.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Job stalled: id=${jobId} — will be re-queued by BullMQ`);
  }
}
