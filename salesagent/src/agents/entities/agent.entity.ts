import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { AgentStatus } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AgentConfig } from './agent-config.entity';

/**
 * Agent is the top-level AI sales agent definition per tenant.
 * Lightweight identity record — heavy configuration lives in AgentConfig.
 * One tenant may have multiple agents (e.g. different products / languages).
 */
@Entity('agents')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'slug'], { unique: true })
export class Agent extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  /**
   * URL-friendly identifier. Used in the widget embed: ?agent=<slug>
   * Unique per tenant (composite unique index).
   */
  @Column({ type: 'varchar', length: 100, nullable: false })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: AgentStatus,
    default: AgentStatus.DRAFT,
    nullable: false,
  })
  status: AgentStatus;

  /** Skills enabled for this agent. Subset of all registered skill names. */
  @Column({ type: 'text', array: true, name: 'enabled_skills', default: '{}' })
  enabledSkills: string[];

  /**
   * FK to AgentConfig (1:1). Stored separately to keep this table lean
   * and avoid loading the full 10KB+ persona/config on list queries.
   */
  @Column({ type: 'uuid', name: 'config_id', nullable: true })
  configId: string | null;

  @Column({ type: 'timestamptz', name: 'deployed_at', nullable: true })
  deployedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToOne(() => AgentConfig, (config) => config.agent, {
    cascade: ['insert', 'update'],
    eager: false,
  })
  @JoinColumn({ name: 'config_id' })
  config: AgentConfig;
}
