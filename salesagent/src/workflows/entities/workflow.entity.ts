import {
  Entity,
  Column,
  Index,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { WorkflowExecution } from './workflow-execution.entity';
import { WorkflowTrigger, WorkflowStep } from '../interfaces/workflow-step.interface';

/**
 * Workflow — an automated sequence of steps triggered by a business event.
 *
 * A workflow is defined once per tenant and can execute many times (one
 * WorkflowExecution per triggering event). Steps run sequentially with
 * optional per-step delays (BullMQ delayed jobs).
 *
 * Example: "Post-Conversation Follow-Up"
 *   trigger: CONVERSATION_ENDED
 *   steps:
 *     [0] { type: WAIT, delayHours: 1 }
 *     [1] { type: SEND_EMAIL, config: { templateId: 'intro', subject: '...' } }
 *     [2] { type: WAIT, delayHours: 24 }
 *     [3] { type: PUSH_TO_CRM, config: {} }
 */
@Entity('workflows')
@Index(['tenantId', 'trigger', 'isActive'])
@Index(['tenantId', 'createdAt'])
export class Workflow extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: WorkflowTrigger,
    nullable: false,
  })
  trigger: WorkflowTrigger;

  /**
   * Ordered sequence of steps. Executed by FollowUpWorker one at a time.
   * WAIT steps delay the next step (via BullMQ delayed jobs) rather than
   * blocking a worker thread.
   */
  @Column({ type: 'jsonb', nullable: false, default: '[]' })
  steps: WorkflowStep[];

  @Column({ type: 'boolean', name: 'is_active', default: true, nullable: false })
  isActive: boolean;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => WorkflowExecution, (execution) => execution.workflow)
  executions: WorkflowExecution[];
}
