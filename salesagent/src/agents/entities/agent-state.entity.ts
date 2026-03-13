import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { ConversationStage } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Agent } from './agent.entity';

export interface WorkingMemory {
  /** Assembled system prompt for the current turn. */
  systemPrompt: string;
  /** Token count of the assembled context. */
  contextTokens: number;
  /** IDs of KnowledgeChunks retrieved for this turn. */
  retrievedChunkIds: string[];
  /** Lead profile summary injected into system prompt. */
  leadSummary: Record<string, unknown> | null;
}

export interface PendingToolCall {
  toolCallId: string;
  skillName: string;
  args: Record<string, unknown>;
}

/**
 * AgentState is the live reasoning state for one active conversation.
 * One record per conversation (upserted on each agent turn).
 *
 * Unlike AgentSession (which is a historical record per turn),
 * AgentState is mutable and reflects the current snapshot:
 * — what stage the agent is in
 * — what it retrieved from the knowledge base this turn
 * — whether a tool call is in progress
 *
 * Useful for: debugging stuck conversations, human handoff context,
 * resuming after WS disconnection.
 */
@Entity('agent_states')
@Index(['tenantId', 'conversationId'], { unique: true })  // one live state per conversation
@Index(['tenantId', 'isProcessing'])
export class AgentState extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'conversation_id', nullable: false, unique: true })
  conversationId: string;

  @Column({ type: 'uuid', name: 'agent_id', nullable: false })
  agentId: string;

  @Column({
    type: 'enum',
    enum: ConversationStage,
    name: 'current_stage',
    default: ConversationStage.GREETING,
    nullable: false,
  })
  currentStage: ConversationStage;

  /**
   * True while the agent reasoning loop is executing.
   * Prevents concurrent invocations for the same conversation.
   * Must be reset to false on completion or timeout.
   */
  @Column({ type: 'boolean', name: 'is_processing', default: false, nullable: false })
  isProcessing: boolean;

  /**
   * Current tool-call iteration count within a single turn.
   * Reset to 0 at the start of each user message. Max 3.
   */
  @Column({ type: 'smallint', name: 'iteration_count', default: 0, nullable: false })
  iterationCount: number;

  /**
   * Assembled context for the current (or last completed) turn.
   * Includes system prompt, retrieved chunks, and lead summary.
   */
  @Column({ type: 'jsonb', name: 'working_memory', nullable: true })
  workingMemory: WorkingMemory | null;

  /**
   * If a tool call is in-flight (streaming was interrupted), the pending call
   * is stored here so the agent can resume after reconnection.
   */
  @Column({ type: 'jsonb', name: 'pending_tool_call', nullable: true })
  pendingToolCall: PendingToolCall | null;

  /** Timestamp when isProcessing was set true. Used to detect stuck sessions (timeout). */
  @Column({ type: 'timestamptz', name: 'processing_started_at', nullable: true })
  processingStartedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;
}
