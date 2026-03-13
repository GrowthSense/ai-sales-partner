import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Skill } from './skill.entity';

/**
 * TenantSkill activates a global Skill for a specific tenant,
 * with optional per-tenant configuration overrides.
 *
 * Examples of per-tenant config:
 *   ScheduleDemo: { calendlyEventTypeId: 'abc123', provider: 'calendly' }
 *   PushToCRM:    { defaultOwner: 'sales@acme.com', pipeline: 'inbound' }
 *   AnswerQuestion: { maxChunks: 3, confidenceThreshold: 0.7 }
 */
@Entity('tenant_skills')
@Index(['tenantId', 'skillId'], { unique: true })
@Index(['tenantId', 'isEnabled'])
export class TenantSkill extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'skill_id', nullable: false })
  skillId: string;

  @Column({ type: 'boolean', name: 'is_enabled', default: true, nullable: false })
  isEnabled: boolean;

  /**
   * Per-tenant overrides merged with global skill defaults at execution time.
   * Structure is skill-specific — validated by the skill's own config schema.
   */
  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  config: Record<string, unknown>;

  /**
   * Execution priority when multiple skills are applicable.
   * Lower number = higher priority. Default 100.
   */
  @Column({ type: 'int', default: 100, nullable: false })
  priority: number;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Skill, (skill) => skill.tenantSkills, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;
}
