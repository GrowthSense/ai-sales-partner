import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
  DeleteDateColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { ConversationStatus, ConversationStage } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Agent } from '../../agents/entities/agent.entity';
import { ConversationMessage } from './conversation-message.entity';

export interface ConversationMetadata {
  pageUrl: string | null;
  pageTitle: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | null;
  userAgent: string | null;
  ipAddress: string | null;     // anonymised (last octet zeroed) for GDPR
  countryCode: string | null;   // 2-letter ISO
}

/**
 * Conversation is one chat session between a visitor and an AI agent.
 * Soft-deleted after conversationRetentionDays (per tenant settings).
 *
 * Lifecycle:
 *   ACTIVE -> ENDED  (conversation.end WS event or inactivity timeout)
 *   ACTIVE -> PAUSED (HandoffToHuman skill executed)
 *   ACTIVE -> ABANDONED (visitor left before sending any message)
 */
@Entity('conversations')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'currentStage'])
@Index(['tenantId', 'visitorId'])
@Index(['tenantId', 'agentId'])
export class Conversation extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'agent_id', nullable: false })
  agentId: string;

  /**
   * Anonymous visitor UUID from the widget JWT.
   * Stable per browser/device — used to associate multiple conversations
   * with the same visitor and merge into one Lead record.
   */
  @Column({ type: 'uuid', name: 'visitor_id', nullable: false })
  visitorId: string;

  @Column({
    type: 'enum',
    enum: ConversationStatus,
    default: ConversationStatus.ACTIVE,
    nullable: false,
  })
  status: ConversationStatus;

  @Column({
    type: 'enum',
    enum: ConversationStage,
    name: 'current_stage',
    default: ConversationStage.GREETING,
    nullable: false,
  })
  currentStage: ConversationStage;

  /**
   * FK to the Lead record created from this conversation.
   * Null until CaptureContact skill fires and creates the Lead.
   */
  @Column({ type: 'uuid', name: 'lead_id', nullable: true })
  leadId: string | null;

  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  metadata: ConversationMetadata;

  @Column({ type: 'int', name: 'message_count', default: 0, nullable: false })
  messageCount: number;

  @Column({ type: 'int', name: 'total_tokens', default: 0, nullable: false })
  totalTokens: number;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'last_message_at', nullable: true })
  lastMessageAt: Date | null;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL', nullable: true, eager: false })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @OneToMany(() => ConversationMessage, (msg) => msg.conversation)
  messages: ConversationMessage[];
}
