import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { MCPProviderStatus } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Tool } from '../../tools/entities/tool.entity';

export interface McpAuthConfig {
  /** AES-256-GCM encrypted auth payload. */
  encryptedData: string;
  iv: string;
  authTag: string;
  authType: 'bearer' | 'api-key' | 'basic' | 'none';
}

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCPProvider is a registered Model Context Protocol server for a tenant.
 * Exposes custom tools (inventory lookups, proprietary APIs, internal systems)
 * that the agent can call alongside built-in skills.
 *
 * Security guarantees:
 *   - All MCP calls are server-side only (credentials never reach browser)
 *   - Credentials encrypted with AES-256-GCM using ENCRYPTION_KEY
 *   - Per-call timeout (MCP_CALL_TIMEOUT_MS) and response cap (50KB)
 *   - Rate limited per provider via Redis sliding window
 */
@Entity('mcp_providers')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'isActive'])
export class MCPProvider extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 2048, nullable: false })
  endpoint: string;

  /**
   * Encrypted auth config. Decrypted only at call time by McpProxyService.
   * select: false ensures it is never accidentally included in API responses.
   */
  @Column({ type: 'jsonb', name: 'auth_config', nullable: true, select: false })
  authConfig: McpAuthConfig | null;

  /**
   * Cached tool schemas from the provider's GET /tools endpoint.
   * Re-synced on: registration, manual sync, daily cron.
   */
  @Column({ type: 'jsonb', name: 'tool_schemas', nullable: false, default: '[]' })
  toolSchemas: McpToolSchema[];

  @Column({
    type: 'enum',
    enum: MCPProviderStatus,
    default: MCPProviderStatus.ACTIVE,
    nullable: false,
  })
  status: MCPProviderStatus;

  @Column({ type: 'boolean', name: 'is_active', default: true, nullable: false })
  isActive: boolean;

  /** Human-readable error from last failed sync. */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date | null;

  /** Max calls per minute for this provider. Enforced via Redis sliding window. */
  @Column({ type: 'int', name: 'rate_limit_rpm', nullable: false, default: 60 })
  rateLimitRpm: number;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
