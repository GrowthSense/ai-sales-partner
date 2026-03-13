import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { ToolType } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { ManyToOne, JoinColumn } from 'typeorm';

export interface HttpToolConfig {
  baseUrl: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;   // non-secret headers only
  timeoutMs: number;
}

/**
 * Tool is a low-level callable action registered per tenant.
 * Tools are called by Skills (e.g. ScheduleDemoSkill calls a CalendarTool).
 * MCP tools are also represented here when synced from an MCPProvider.
 *
 * Unlike Skills (which have LLM-facing descriptions), Tools are internal
 * infrastructure — not directly visible to the LLM.
 */
@Entity('tools')
@Index(['tenantId', 'type'])
@Index(['tenantId', 'isActive'])
@Index(['tenantId', 'name'], { unique: true })
export class Tool extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: ToolType,
    nullable: false,
  })
  type: ToolType;

  /**
   * For HTTP tools: endpoint config (non-secret parts).
   * For MCP tools: pointer to MCPProvider + tool name.
   */
  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  config: HttpToolConfig | Record<string, unknown>;

  /** JSON Schema for tool input parameters. */
  @Column({ type: 'jsonb', name: 'input_schema', nullable: true })
  inputSchema: Record<string, unknown> | null;

  /** ID of the MCPProvider this tool was synced from. Null for non-MCP tools. */
  @Column({ type: 'uuid', name: 'mcp_provider_id', nullable: true })
  mcpProviderId: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true, nullable: false })
  isActive: boolean;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
