import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { McpServer, McpToolSchema } from '../entities/mcp-server.entity';
import { McpProxyService, McpCallError } from './mcp-proxy.service';
import { SkillRegistryService } from '../../skills/services/skill-registry.service';
import { ISkill, SkillContext, SkillResult } from '../../skills/interfaces/skill.interface';
import { EncryptionService } from '../../common/services/encryption.service';
import { MCPProviderStatus } from '../../common/enums';

/**
 * McpRegistryService
 *
 * Keeps MCP server tool schemas in sync and registers MCP tools as ISkill
 * instances in the SkillRegistry, making them available to the agent's
 * reasoning loop alongside built-in skills.
 *
 * Flow:
 *  1. Register server → syncTools() → GET /tools → store schemas
 *  2. Wrap each tool schema as an ISkill (McpToolSkill adapter)
 *  3. Register all wrapped tools into SkillRegistryService
 *  4. Daily cron calls syncAll() to refresh schemas
 *
 * MCP tool skill names are prefixed: `mcp:<serverId>:<toolName>`
 * This prefix is used by deregisterServer() to bulk-remove tools.
 */
@Injectable()
export class McpRegistryService implements OnModuleInit {
  private readonly logger = new Logger(McpRegistryService.name);

  constructor(
    @InjectRepository(McpServer)
    private readonly serverRepo: Repository<McpServer>,

    private readonly proxy: McpProxyService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly encryption: EncryptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Re-register all active MCP tools on startup (in case of restart)
    await this.syncAll().catch((err) =>
      this.logger.error('MCP sync-on-startup failed', err),
    );
  }

  // ─── Server registration ──────────────────────────────────────────────────

  async registerServer(
    tenantId: string,
    name: string,
    endpoint: string,
    authConfig?: {
      authType: 'bearer' | 'api-key' | 'basic' | 'none';
      token?: string;
      username?: string;
    },
    rateLimitRpm = 60,
  ): Promise<McpServer> {
    const encryptedAuth = authConfig && authConfig.authType !== 'none'
      ? {
          ...this.encryption.encryptJson({ ...authConfig }),
          authType: authConfig.authType,
        }
      : null;

    const server = this.serverRepo.create({
      tenantId,
      name,
      endpoint,
      authConfig: encryptedAuth as McpServer['authConfig'],
      rateLimitRpm,
      toolSchemas: [],
      status: MCPProviderStatus.ACTIVE,
      isActive: true,
    });

    const saved = await this.serverRepo.save(server);

    // Immediately sync tools
    await this.syncTools(saved.id, tenantId);

    return saved;
  }

  // ─── Tool schema sync ─────────────────────────────────────────────────────

  async syncTools(serverId: string, tenantId: string): Promise<void> {
    this.logger.debug(`Syncing MCP tools for server ${serverId}`);

    try {
      const rawSchemas = await this.proxy.fetchToolSchemas(serverId, tenantId);

      const toolSchemas: McpToolSchema[] = rawSchemas
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          name: String(s['name'] ?? ''),
          description: String(s['description'] ?? ''),
          inputSchema: (s['inputSchema'] as Record<string, unknown>) ?? {},
        }))
        .filter((s) => s.name.length > 0);

      await this.serverRepo.update(serverId, {
        toolSchemas: toolSchemas as any,
        status: MCPProviderStatus.ACTIVE,
        lastError: null,
        lastSyncedAt: new Date(),
      });

      // Re-register all tools for this server in SkillRegistry
      this.deregisterServerTools(serverId);
      for (const schema of toolSchemas) {
        const skill = this.wrapAsSkill(serverId, tenantId, schema);
        this.skillRegistry.register(skill);
      }

      this.logger.log(
        `MCP server ${serverId} synced: ${toolSchemas.length} tools registered`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.serverRepo.update(serverId, {
        status: MCPProviderStatus.SYNC_ERROR,
        lastError: message.slice(0, 500),
      });
      this.logger.error(`MCP sync failed for server ${serverId}: ${message}`);
    }
  }

  /** Deregister a server and all its tools. */
  async deregisterServer(serverId: string): Promise<void> {
    this.deregisterServerTools(serverId);
    await this.serverRepo.update(serverId, { isActive: false, status: MCPProviderStatus.INACTIVE });
    this.logger.log(`MCP server ${serverId} deregistered`);
  }

  /** Return all MCP-wrapped ISkill instances currently registered for a tenant. */
  getActiveTools(tenantId: string): ISkill[] {
    return this.skillRegistry
      .getAll()
      .filter((s) => s.name.startsWith('mcp:') && s.name.includes(`:${tenantId}:`));
  }

  // ─── Daily sync cron ──────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async syncAll(): Promise<void> {
    const servers = await this.serverRepo.find({ where: { isActive: true } });
    this.logger.log(`Daily MCP sync: ${servers.length} active servers`);

    await Promise.allSettled(
      servers.map((s) => this.syncTools(s.id, s.tenantId)),
    );
  }

  // ─── ISkill adapter ───────────────────────────────────────────────────────

  /**
   * Wraps an McpToolSchema as an ISkill so it can be registered in the
   * SkillRegistry and included in the OpenAI tools array for the LLM.
   *
   * When the LLM calls this skill, SkillExecutorService calls execute(),
   * which proxies the call to the MCP server via McpProxyService.
   */
  private wrapAsSkill(
    serverId: string,
    tenantId: string,
    schema: McpToolSchema,
  ): ISkill {
    const proxy = this.proxy;

    return {
      // Name format: mcp:<serverId>:<toolName>
      // The serverId is embedded so deregistration can bulk-remove by prefix.
      name: `mcp:${serverId}:${schema.name}`,

      // The LLM sees the tool's original description (not the prefix)
      description: schema.description,

      parameters: schema.inputSchema,

      async execute(
        args: unknown,
        ctx: SkillContext,
      ): Promise<SkillResult> {
        try {
          const data = await proxy.call(
            serverId,
            schema.name,
            args as Record<string, unknown>,
            ctx.tenantId,
          );
          return { success: true, data };
        } catch (err: unknown) {
          const message = err instanceof McpCallError ? err.message : String(err);
          return { success: false, data: { error: message } };
        }
      },
    };
  }

  private deregisterServerTools(serverId: string): void {
    // SkillRegistryService.deregisterByPrefix() removes all skills whose name
    // starts with the given prefix (mcp:<serverId>:)
    const prefix = `mcp:${serverId}:`;
    for (const skill of this.skillRegistry.getAll()) {
      if (skill.name.startsWith(prefix)) {
        this.skillRegistry.deregister(skill.name);
      }
    }
  }
}
