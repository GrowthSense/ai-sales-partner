import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { IntegrationType, IntegrationStatus } from '../../common/enums';
import { Tenant } from './tenant.entity';

export interface IntegrationCredentials {
  /** All values are AES-256-GCM encrypted. Never store plaintext secrets in DB. */
  encryptedData: string;       // encrypted JSON blob
  iv: string;                  // AES initialisation vector (hex)
  authTag: string;             // GCM authentication tag (hex)
}

export interface IntegrationConfig {
  /** Provider-specific non-secret config (safe to store as-is). */
  [key: string]: unknown;
  // CRM: instanceUrl, defaultLeadStage, fieldMapping
  // Calendar: eventTypeId, username, timezone
  // Email: fromName, replyTo
  // Webhook: url, headers (non-secret), events[]
}

/**
 * Stores per-tenant third-party integration configuration.
 * One record per integration type per tenant (unique constraint).
 * Credentials are encrypted at the service layer using ENCRYPTION_KEY env var.
 */
@Entity('tenant_integrations')
@Index(['tenantId', 'type'], { unique: true })
@Index(['tenantId', 'status'])
export class TenantIntegration extends BaseEntity {
  @Column({ type: 'uuid', name: 'tenant_id', nullable: false })
  tenantId: string;

  @Column({
    type: 'enum',
    enum: IntegrationType,
    nullable: false,
  })
  type: IntegrationType;

  @Column({
    type: 'enum',
    enum: IntegrationStatus,
    default: IntegrationStatus.DISCONNECTED,
    nullable: false,
  })
  status: IntegrationStatus;

  /**
   * AES-256-GCM encrypted credentials (API keys, OAuth tokens, secrets).
   * Decrypted at the service layer using ENCRYPTION_KEY. Never logged.
   * select: false ensures this is never accidentally included in query results.
   */
  @Column({ type: 'jsonb', nullable: true, select: false })
  credentials: IntegrationCredentials | null;

  /** Non-sensitive provider config (field mappings, event type IDs, etc.). */
  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  config: IntegrationConfig;

  /** Human-readable error message if status = ERROR. */
  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  /** Last time the integration was successfully tested or used. */
  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'connected_at', nullable: true })
  connectedAt: Date | null;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Tenant, (tenant) => tenant.integrations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
