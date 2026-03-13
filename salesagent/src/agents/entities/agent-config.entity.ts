import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Agent } from './agent.entity';
import { ConversationStage } from '../../common/enums';

export interface LlmConfig {
  model: string;            // 'gpt-4o'
  temperature: number;      // 0.0 – 2.0, default 0.3
  maxTokens: number;        // max response tokens, default 4096
  streaming: boolean;       // true for real-time WS streaming
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface StageInstruction {
  instructions: string;        // injected into system prompt for this stage
  requiredSkills?: string[];   // must be called before stage can advance
  maxTurns?: number;           // soft limit before auto-advance
  autoAdvanceTo?: ConversationStage;
}

export type StageConfig = Partial<Record<ConversationStage, StageInstruction>>;

export interface RagConfig {
  topK: number;              // chunks to retrieve, default 5
  rerankEnabled: boolean;
  rerankTimeoutMs: number;   // skip rerank if retrieval exceeds this
  hybridSearchWeight: number; // 0-1, weight for semantic vs keyword (1 = pure semantic)
}

/**
 * AgentConfig stores the full agent behaviour specification.
 * Separated from Agent so that list queries on agents stay fast
 * (no large TEXT persona column in the result set).
 *
 * One-to-one with Agent.
 */
@Entity('agent_configs')
@Index(['tenantId'])
export class AgentConfig extends TenantScopedEntity {
  /**
   * System prompt persona injected before every conversation context.
   * Describes the agent's name, role, tone, company background, and constraints.
   * Typically 200–800 tokens.
   */
  @Column({ type: 'text', nullable: false })
  persona: string;

  /**
   * Fallback message when the agent cannot answer from knowledge base.
   * e.g. "I'm not sure about that — let me connect you with our team."
   */
  @Column({ type: 'text', name: 'fallback_message', nullable: true })
  fallbackMessage: string | null;

  /** OpenAI model + sampling parameters. */
  @Column({ type: 'jsonb', name: 'llm_config', nullable: false })
  llmConfig: LlmConfig;

  /** Per-stage prompt injections and transition rules. */
  @Column({ type: 'jsonb', name: 'stage_config', nullable: false, default: '{}' })
  stageConfig: StageConfig;

  /** RAG retrieval tuning parameters. */
  @Column({ type: 'jsonb', name: 'rag_config', nullable: false })
  ragConfig: RagConfig;

  /**
   * Prompt template variables injected at conversation start.
   * e.g. { companyName, productName, pricingPageUrl }
   */
  @Column({ type: 'jsonb', name: 'template_vars', nullable: false, default: '{}' })
  templateVars: Record<string, string>;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToOne(() => Agent, (agent) => agent.config)
  agent: Agent;
}
