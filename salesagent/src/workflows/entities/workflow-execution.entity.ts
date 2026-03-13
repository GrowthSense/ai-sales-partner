import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Workflow } from './workflow.entity';

export type WorkflowExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutionLog {
  stepIndex: number;
  stepType: string;
  startedAt: string;     // ISO timestamp
  completedAt?: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * WorkflowExecution — one run of a Workflow triggered by a business event.
 *
 * Each lead + trigger combination may generate one or more executions
 * (depending on how many workflows match). The FollowUpWorker advances
 * currentStep, appending to logs after each step.
 */
@Entity('workflow_executions')
@Index(['tenantId', 'leadId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'workflowId'])
export class WorkflowExecution extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'workflow_id', nullable: false })
  workflowId: string;

  @Column({ type: 'uuid', name: 'lead_id', nullable: false })
  leadId: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: false,
    default: 'running',
  })
  status: WorkflowExecutionStatus;

  /** Index of the next step to execute (0-based). */
  @Column({ type: 'smallint', name: 'current_step', default: 0, nullable: false })
  currentStep: number;

  /** Append-only execution log — one entry per completed step. */
  @Column({ type: 'jsonb', default: '[]', nullable: false })
  logs: ExecutionLog[];

  @Column({ type: 'timestamptz', name: 'started_at', nullable: false, default: () => 'NOW()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Workflow, (workflow) => workflow.executions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;
}
