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
import { LeadStatus, LeadSource } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { LeadActivity } from './lead-activity.entity';
import { Meeting } from './meeting.entity';

export interface BantQualification {
  budget: string | null;           // e.g. "$10K–$50K/year"
  hasBudget: boolean | null;
  authority: string | null;        // e.g. "VP of Sales"
  isDecisionMaker: boolean | null;
  need: string | null;             // pain point description
  needStrength: 'low' | 'medium' | 'high' | null;
  timeline: string | null;         // e.g. "Q3 2026"
  hasTimeline: boolean | null;
  notes: string | null;            // free-form notes from conversation
}

export interface LeadEnrichment {
  /** Data from external enrichment APIs (Clearbit, Apollo, etc.) */
  companySize?: string;
  industry?: string;
  annualRevenue?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  companyWebsite?: string;
  enrichedAt?: string;             // ISO timestamp
  provider?: string;               // 'clearbit' | 'apollo'
}

/**
 * Lead represents a visitor who has been identified during a conversation.
 * Built progressively: CaptureContact fills PII, QualifyLead fills BANT data.
 *
 * A Lead is linked to the originating conversation. Additional conversations
 * from the same visitor are linked back to this lead via visitorId.
 *
 * Soft-deleted (DeleteDateColumn) so CRM sync records remain coherent.
 */
@Entity('leads')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'score'])
@Index(['tenantId', 'email'])
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'visitorId'])
@Index(['conversationId'], { unique: true })
export class Lead extends TenantScopedEntity {
  /**
   * Anonymous visitor UUID from the widget session JWT.
   * Allows linking multiple conversations to the same lead.
   */
  @Column({ type: 'uuid', name: 'visitor_id', nullable: false })
  visitorId: string;

  /** The conversation that first created this lead record. */
  @Column({ type: 'uuid', name: 'conversation_id', nullable: false, unique: true })
  conversationId: string;

  // ─── Contact Info ──────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 255, name: 'job_title', nullable: true })
  jobTitle: string | null;

  // ─── Status & Scoring ─────────────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: LeadStatus,
    default: LeadStatus.NEW,
    nullable: false,
  })
  status: LeadStatus;

  @Column({
    type: 'enum',
    enum: LeadSource,
    default: LeadSource.WEBSITE_CHAT,
    nullable: false,
  })
  source: LeadSource;

  /**
   * 0–100 score computed from BANT qualification completeness.
   * Recomputed by QualificationService on every qualification update.
   * budget(25) + authority(25) + need(25) + timeline(25)
   */
  @Column({ type: 'smallint', default: 0, nullable: false })
  score: number;

  // ─── Qualification Data ────────────────────────────────────────────────────
  @Column({ type: 'jsonb', name: 'qualification_data', nullable: false, default: '{}' })
  qualificationData: BantQualification;

  /** Optional external enrichment data (Clearbit, Apollo, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  enrichment: LeadEnrichment | null;

  // ─── CRM Sync ─────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 255, name: 'crm_id', nullable: true })
  crmId: string | null;

  @Column({ type: 'timestamptz', name: 'crm_synced_at', nullable: true })
  crmSyncedAt: Date | null;

  // ─── UTM / Attribution ────────────────────────────────────────────────────
  @Column({ type: 'jsonb', nullable: true })
  attribution: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    landingPage?: string;
  } | null;

  /** Soft-delete: record is retained for CRM sync integrity. */
  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => LeadActivity, (activity) => activity.lead)
  activities: LeadActivity[];

  @OneToMany(() => Meeting, (meeting) => meeting.lead)
  meetings: Meeting[];
}
