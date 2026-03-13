import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { MeetingStatus, MeetingType } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Lead } from './lead.entity';

/**
 * Meeting records a scheduled demo, discovery call, or follow-up call.
 * Created by the ScheduleDemo skill when a visitor books via Calendly or Cal.com.
 *
 * Also used for manually scheduled meetings by admin users.
 */
@Entity('meetings')
@Index(['tenantId', 'leadId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'scheduledAt'])
@Index(['externalBookingId'])
export class Meeting extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'lead_id', nullable: false })
  leadId: string;

  /** Optional: linked conversation that triggered the booking. */
  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId: string | null;

  @Column({
    type: 'enum',
    enum: MeetingType,
    default: MeetingType.DEMO,
    nullable: false,
  })
  type: MeetingType;

  @Column({
    type: 'enum',
    enum: MeetingStatus,
    default: MeetingStatus.SCHEDULED,
    nullable: false,
  })
  status: MeetingStatus;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'timestamptz', name: 'scheduled_at', nullable: false })
  scheduledAt: Date;

  @Column({ type: 'int', name: 'duration_minutes', nullable: false, default: 30 })
  durationMinutes: number;

  /** Calendar provider booking URL returned to the visitor. */
  @Column({ type: 'varchar', length: 2048, name: 'booking_url', nullable: true })
  bookingUrl: string | null;

  /** ID from Calendly (uuid) or Cal.com (int/string) for webhook correlation. */
  @Column({ type: 'varchar', length: 255, name: 'external_booking_id', nullable: true })
  externalBookingId: string | null;

  /** Which calendar integration provided this booking. */
  @Column({ type: 'varchar', length: 50, name: 'calendar_provider', nullable: true })
  calendarProvider: string | null;

  /** Attendee details cached at booking time. */
  @Column({ type: 'varchar', length: 255, name: 'attendee_email', nullable: true })
  attendeeEmail: string | null;

  @Column({ type: 'varchar', length: 255, name: 'attendee_name', nullable: true })
  attendeeName: string | null;

  /** Admin/host user ID assigned to run this meeting. */
  @Column({ type: 'uuid', name: 'host_user_id', nullable: true })
  hostUserId: string | null;

  @Column({ type: 'text', name: 'cancellation_reason', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  /** Free-form notes added after the call. */
  @Column({ type: 'text', name: 'post_meeting_notes', nullable: true })
  postMeetingNotes: string | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Lead, (lead) => lead.meetings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
