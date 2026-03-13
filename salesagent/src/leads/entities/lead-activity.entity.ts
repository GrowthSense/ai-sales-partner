import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { LeadActivityType, LeadStatus } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Lead } from './lead.entity';

/**
 * LeadActivity is an append-only audit trail for a lead's lifecycle.
 * Every significant state change, action, or touchpoint is recorded here.
 *
 * Immutable — records are never updated or deleted.
 * Used for: timeline views, analytics, CRM sync history, compliance.
 */
@Entity('lead_activities')
@Index(['tenantId', 'leadId', 'createdAt'])   // timeline query (hot path)
@Index(['tenantId', 'type'])
@Index(['leadId'])
export class LeadActivity extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'lead_id', nullable: false })
  leadId: string;

  @Column({
    type: 'enum',
    enum: LeadActivityType,
    nullable: false,
  })
  type: LeadActivityType;

  /** Human-readable description of the activity. */
  @Column({ type: 'text', nullable: false })
  description: string;

  /**
   * Stage before this activity (for STAGE_CHANGED events).
   * Null for creation and non-stage events.
   */
  @Column({
    type: 'enum',
    enum: LeadStatus,
    name: 'previous_status',
    nullable: true,
  })
  previousStatus: LeadStatus | null;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    name: 'new_status',
    nullable: true,
  })
  newStatus: LeadStatus | null;

  /**
   * Arbitrary metadata for the activity type:
   * EMAIL_SENT: { subject, templateId, messageId }
   * CRM_SYNCED: { crmId, provider, operation }
   * MEETING_SCHEDULED: { meetingId, scheduledAt, type }
   * NOTE_ADDED: { note }
   */
  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  metadata: Record<string, unknown>;

  /**
   * Who performed this activity.
   * Null for system/agent actions.
   */
  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  /** 'agent' | 'user' | 'system' | 'crm' */
  @Column({ type: 'varchar', length: 50, name: 'actor_type', nullable: false, default: 'agent' })
  actorType: string;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Lead, (lead) => lead.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
