import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TenantMemberRole, TenantMemberStatus } from '../../common/enums';
import { Tenant } from './tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * TenantMember is the junction between User and Tenant.
 * Richer than a simple many-to-many — stores role, status, and invite metadata.
 *
 * A User can be a member of multiple tenants (e.g. an agency managing clients).
 * OWNER role is assigned on tenant creation and cannot be transferred via API.
 */
@Entity('tenant_members')
@Index(['tenantId', 'userId'], { unique: true })  // one record per user-tenant pair
@Index(['tenantId', 'role'])
@Index(['tenantId', 'status'])
@Index(['userId'])
export class TenantMember extends BaseEntity {
  @Column({ type: 'uuid', name: 'tenant_id', nullable: false })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @Column({
    type: 'enum',
    enum: TenantMemberRole,
    default: TenantMemberRole.MEMBER,
    nullable: false,
  })
  role: TenantMemberRole;

  @Column({
    type: 'enum',
    enum: TenantMemberStatus,
    default: TenantMemberStatus.PENDING,
    nullable: false,
  })
  status: TenantMemberStatus;

  /** Email used when sending the invitation (may differ from user.email if pre-registered). */
  @Column({ type: 'varchar', length: 255, name: 'invited_email', nullable: false })
  invitedEmail: string;

  /** UUID token sent in the invite email. Nulled after acceptance. */
  @Column({ type: 'uuid', name: 'invite_token', nullable: true, select: false })
  inviteToken: string | null;

  @Column({ type: 'timestamptz', name: 'invite_expires_at', nullable: true })
  inviteExpiresAt: Date | null;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, (tenant) => tenant.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => User, (user) => user.tenantMemberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
