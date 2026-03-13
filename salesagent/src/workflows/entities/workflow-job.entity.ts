import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { WorkflowJobType, WorkflowJobStatus } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';

export interface JobResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * WorkflowJob is a DB-persisted record for every async background job.
 * Provides observability, retry tracking, and audit trail for all
 * queue-based operations — supplementing BullMQ's in-memory state.
 *
 * Every BullMQ job producer writes a WorkflowJob record BEFORE enqueuing.
 * The corresponding worker updates status to RUNNING -> COMPLETED/FAILED.
 *
 * Retry logic:
 *   BullMQ handles retry scheduling (exponential backoff).
 *   attemptCount + maxAttempts are mirrored here for dashboard display.
 */
@Entity('workflow_jobs')
@Index(['tenantId', 'type', 'status'])
@Index(['tenantId', 'status', 'scheduledAt'])
@Index(['tenantId', 'referenceId'])           // look up jobs by entity (lead, document...)
@Index(['bullmqJobId'])
export class WorkflowJob extends TenantScopedEntity {
  @Column({
    type: 'enum',
    enum: WorkflowJobType,
    nullable: false,
  })
  type: WorkflowJobType;

  @Column({
    type: 'enum',
    enum: WorkflowJobStatus,
    default: WorkflowJobStatus.PENDING,
    nullable: false,
  })
  status: WorkflowJobStatus;

  /**
   * The ID of the entity this job operates on.
   * e.g. leadId for CRM_SYNC, documentId for KNOWLEDGE_INGEST.
   */
  @Column({ type: 'uuid', name: 'reference_id', nullable: false })
  referenceId: string;

  /**
   * Human-readable type of the reference entity.
   * e.g. 'lead', 'knowledge_document', 'conversation'
   */
  @Column({ type: 'varchar', length: 50, name: 'reference_type', nullable: false })
  referenceType: string;

  /** Job input payload (mirrors BullMQ job data). */
  @Column({ type: 'jsonb', nullable: false })
  payload: Record<string, unknown>;

  /** BullMQ job ID for correlation. */
  @Column({ type: 'varchar', length: 255, name: 'bullmq_job_id', nullable: true })
  bullmqJobId: string | null;

  /** BullMQ queue name. */
  @Column({ type: 'varchar', length: 100, name: 'queue_name', nullable: false })
  queueName: string;

  /** Result from the last execution attempt. */
  @Column({ type: 'jsonb', nullable: true })
  result: JobResult | null;

  /** Last error message (if status = FAILED or RETRYING). */
  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'smallint', name: 'attempt_count', default: 0, nullable: false })
  attemptCount: number;

  @Column({ type: 'smallint', name: 'max_attempts', default: 3, nullable: false })
  maxAttempts: number;

  /** When the job is scheduled to run (for delayed jobs). */
  @Column({ type: 'timestamptz', name: 'scheduled_at', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
