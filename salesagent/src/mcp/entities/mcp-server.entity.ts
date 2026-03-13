import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { MCPProviderStatus } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';

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
 * McpServer — registered Model Context Protocol server for a tenant.
 *
 * Exposes custom tools (inventory lookups, proprietary APIs, internal CRM)
 * that the agent can call alongside built-in skills.
 *
 * Security:
 *  - authConfig is AES-256-GCM encrypted; never returned in API responses
 *  - All MCP calls are server-side proxied (McpProxyService)
 *  - Rate limited per server via Redis sliding window (rateLimitRpm)
 *  - 10s timeout, 50KB response cap per call
 */
@Entity('mcp_servers')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'isActive'])
export class McpServer extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 2048, nullable: false })
  endpoint: string;

  /**
   * Encrypted auth config. Decrypted only at call time by McpProxyService.
   * select: false ensures it is never accidentally returned in queries.
   */
  @Column({ type: 'jsonb', name: 'auth_config', nullable: true, select: false })
  authConfig: McpAuthConfig | null;

  /**
   * Cached tool schemas from GET /tools on the MCP server.
   * Re-synced on: registration, manual admin action, daily cron.
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

  /** Max calls per minute for this server (Redis sliding window). */
  @Column({ type: 'int', name: 'rate_limit_rpm', nullable: false, default: 60 })
  rateLimitRpm: number;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
