import {
  Entity,
  Column,
  Index,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { SkillType } from '../../common/enums';
import { TenantSkill } from './tenant-skill.entity';

/**
 * Skill is the global catalog of all available agent capabilities.
 * Built-in skills (AnswerQuestion, QualifyLead, etc.) are seeded via migration.
 * MCP-sourced skills are dynamically registered by McpRegistryService.
 *
 * NOT tenant-scoped at this level — tenants activate skills via TenantSkill.
 */
@Entity('skills')
@Index(['name'], { unique: true })
@Index(['type'])
@Index(['isActive'])
export class Skill extends BaseEntity {
  /**
   * Unique machine-readable name. Used as the OpenAI function name.
   * Must be snake_case or camelCase (no spaces — OpenAI requirement).
   */
  @Column({ type: 'varchar', length: 100, unique: true, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  displayName: string;

  /**
   * Shown to the LLM in the tool definition.
   * Directly influences when/how the model chooses to call this skill.
   * Keep clear, specific, and action-oriented.
   */
  @Column({ type: 'text', nullable: false })
  description: string;

  @Column({
    type: 'enum',
    enum: SkillType,
    nullable: false,
  })
  type: SkillType;

  /**
   * JSON Schema for the skill's input parameters.
   * Fed directly into the OpenAI tools array as function.parameters.
   */
  @Column({ type: 'jsonb', nullable: false })
  parametersSchema: Record<string, unknown>;

  /**
   * JSON Schema describing the skill's output shape.
   * Used to validate skill results before passing back to the LLM.
   */
  @Column({ type: 'jsonb', name: 'output_schema', nullable: true })
  outputSchema: Record<string, unknown> | null;

  /**
   * Category for grouping in the admin UI.
   * e.g. 'qualification', 'crm', 'scheduling', 'knowledge', 'routing'
   */
  @Column({ type: 'varchar', length: 50, nullable: false, default: 'general' })
  category: string;

  /**
   * Minimum tenant plan required to enable this skill.
   * null = available on all plans.
   */
  @Column({ type: 'varchar', length: 20, name: 'min_plan', nullable: true })
  minPlan: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true, nullable: false })
  isActive: boolean;

  /** NestJS class name implementing this skill. Used for DI lookup. */
  @Column({ type: 'varchar', length: 100, name: 'handler_class', nullable: true })
  handlerClass: string | null;

  // --- Relations ---------------------------------------------------------------
  @OneToMany(() => TenantSkill, (ts) => ts.skill)
  tenantSkills: TenantSkill[];
}
