import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { AgentSessionStatus, ConversationStage } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Agent } from './agent.entity';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SkillExecution {
  skillName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  latencyMs: number;
  success: boolean;
}

/**
 * AgentSession records one complete agent reasoning loop invocation —
 * i.e. one user message → one agent response (which may span multiple
 * internal tool iterations, all captured here).
 *
 * Used for: observability, latency tracking, token cost accounting,
 * debugging failed responses, and fine-tuning data collection.
 */
@Entity('agent_sessions')
@Index(['tenantId', 'conversationId'])
@Index(['tenantId', 'agentId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'createdAt'])
export class AgentSession extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'conversation_id', nullable: false })
  conversationId: string;

  @Column({ type: 'uuid', name: 'agent_id', nullable: false })
  agentId: string;

  /** Stage at the moment this session was invoked. */
  @Column({
    type: 'enum',
    enum: ConversationStage,
    name: 'stage_at_start',
    nullable: false,
  })
  stageAtStart: ConversationStage;

  /** Stage after the session completed (may differ if TransitionStage was called). */
  @Column({
    type: 'enum',
    enum: ConversationStage,
    name: 'stage_at_end',
    nullable: true,
  })
  stageAtEnd: ConversationStage | null;

  @Column({
    type: 'enum',
    enum: AgentSessionStatus,
    default: AgentSessionStatus.ACTIVE,
    nullable: false,
  })
  status: AgentSessionStatus;

  /** The user message that triggered this session. */
  @Column({ type: 'text', name: 'input_message', nullable: false })
  inputMessage: string;

  /** The final assistant response text. Null if session failed. */
  @Column({ type: 'text', name: 'output_message', nullable: true })
  outputMessage: string | null;

  /** Skills and tools invoked during this session, in order. */
  @Column({ type: 'jsonb', name: 'skill_executions', nullable: false, default: '[]' })
  skillExecutions: SkillExecution[];

  /** Number of tool-call iterations in the reasoning loop. Max 3. */
  @Column({ type: 'smallint', name: 'iteration_count', default: 0, nullable: false })
  iterationCount: number;

  /** OpenAI token usage across all LLM calls in this session. */
  @Column({ type: 'jsonb', name: 'token_usage', nullable: true })
  tokenUsage: TokenUsage | null;

  /** Total time from first LLM call to final response, in milliseconds. */
  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs: number | null;

  /** Time to first streamed token (user-perceived latency). */
  @Column({ type: 'int', name: 'ttft_ms', nullable: true })
  ttftMs: number | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;
}
