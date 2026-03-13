import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { MessageRole } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Conversation } from './conversation.entity';

export interface OpenAIToolCall {
  id: string;                     // OpenAI tool_call_id
  type: 'function';
  function: {
    name: string;
    arguments: string;            // JSON string
  };
}

/**
 * ConversationMessage is an individual message in the chat thread.
 * Mirrors the OpenAI messages array format exactly so history can be
 * replayed directly into the LLM without transformation.
 *
 * Immutable append-only — messages are never updated after creation.
 * Index on (conversationId, createdAt ASC) is the hot path for history fetch.
 */
@Entity('conversation_messages')
@Index(['conversationId', 'createdAt'])   // hot path: load history ordered ASC
@Index(['tenantId', 'createdAt'])
export class ConversationMessage extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'conversation_id', nullable: false })
  conversationId: string;

  @Column({
    type: 'enum',
    enum: MessageRole,
    nullable: false,
  })
  role: MessageRole;

  /**
   * Message text content.
   * Null when role=ASSISTANT and the response was a pure tool call (no text).
   */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /**
   * OpenAI tool_calls array. Present when role=ASSISTANT and the model
   * called one or more skills. Stored verbatim for exact replay into LLM.
   */
  @Column({ type: 'jsonb', name: 'tool_calls', nullable: true })
  toolCalls: OpenAIToolCall[] | null;

  /**
   * OpenAI tool_call_id. Present when role=TOOL, linking this result
   * message back to the tool_call in the preceding assistant message.
   */
  @Column({ type: 'varchar', length: 255, name: 'tool_call_id', nullable: true })
  toolCallId: string | null;

  /**
   * Name of the skill/tool that produced this message.
   * Present when role=TOOL.
   */
  @Column({ type: 'varchar', length: 100, name: 'tool_name', nullable: true })
  toolName: string | null;

  /**
   * Token count for this message (cl100k_base encoding).
   * Used by MemoryManagerService to enforce context window budget.
   */
  @Column({ type: 'int', name: 'token_count', default: 0, nullable: false })
  tokenCount: number;

  /**
   * Optional FK to the AgentSession that produced this assistant message.
   * Null for user messages and tool results.
   */
  @Column({ type: 'uuid', name: 'session_id', nullable: true })
  sessionId: string | null;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;
}
