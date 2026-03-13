import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { AuditAction, AuditEntityType } from '../enums';

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * AuditLog is an immutable, append-only record of all significant
 * user-initiated and system actions across the platform.
 *
 * Design principles:
 *   - No UpdateDateColumn (records are never modified)
 *   - No DeleteDateColumn (records are never soft-deleted)
 *   - tenantId nullable to support super-admin and cross-tenant actions
 *   - actorUserId nullable for system-initiated actions
 *
 * Retention: AuditLogs are retained for 2 years (configurable),
 * then cold-archived to S3. Never deleted from this table within retention.
 *
 * NOT a TenantScopedEntity subclass — extends BaseEntity directly
 * because some logs are super-admin scoped (no tenant).
 */
@Entity('audit_logs')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'entityType', 'entityId'])
@Index(['tenantId', 'actorUserId', 'createdAt'])
@Index(['action'])
@Index(['createdAt'])        // global retention queries
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Tenant context. Null for super-admin actions (tenant creation, billing events).
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  @Index()
  tenantId: string | null;

  /**
   * The user who performed the action.
   * Null for system/agent/scheduler actions.
   */
  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  /**
   * 'user' | 'agent' | 'system' | 'scheduler' | 'webhook'
   */
  @Column({ type: 'varchar', length: 50, name: 'actor_type', nullable: false, default: 'user' })
  actorType: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    nullable: false,
  })
  action: AuditAction;

  @Column({
    type: 'enum',
    enum: AuditEntityType,
    name: 'entity_type',
    nullable: false,
  })
  entityType: AuditEntityType;

  /** UUID of the affected entity. */
  @Column({ type: 'uuid', name: 'entity_id', nullable: false })
  entityId: string;

  /** Human-readable summary of the action. */
  @Column({ type: 'text', nullable: false })
  description: string;

  /**
   * Snapshot of before/after state for UPDATE actions.
   * Passwords, tokens, and encrypted fields are always excluded.
   */
  @Column({ type: 'jsonb', nullable: true })
  changes: AuditChanges | null;

  /** Arbitrary extra context: IP address, user agent, request ID. */
  @Column({ type: 'jsonb', nullable: true })
  context: {
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    [key: string]: unknown;
  } | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
