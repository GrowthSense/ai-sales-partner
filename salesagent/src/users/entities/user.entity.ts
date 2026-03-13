import {
  Entity,
  Column,
  Index,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { UserStatus } from '../../common/enums';
import { TenantMember } from '../../tenants/entities/tenant-member.entity';

/**
 * User represents a platform-level identity.
 * A single User can belong to multiple tenants via TenantMember (role junction).
 *
 * Email is globally unique at the User level (not per-tenant).
 * Role and permissions are determined by TenantMember.role, not stored here.
 */
@Entity('users')
@Index(['email'], { unique: true })
@Index(['status'])
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  email: string;

  /**
   * Bcrypt hash. NEVER returned in API responses.
   * Select explicitly: repo.findOne({ select: ['id','passwordHash'] })
   */
  @Column({ type: 'varchar', length: 255, name: 'password_hash', nullable: false, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'avatar_url', nullable: true })
  avatarUrl: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
    nullable: false,
  })
  status: UserStatus;

  /** Timestamp of last successful login. Used for idle session cleanup. */
  @Column({ type: 'timestamptz', name: 'last_login_at', nullable: true })
  lastLoginAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => TenantMember, (member) => member.user)
  tenantMemberships: TenantMember[];
}
