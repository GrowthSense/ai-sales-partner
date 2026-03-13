import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ITool } from '../interfaces/tool.interface';

/**
 * ToolRegistryService
 *
 * In-memory registry of all callable tools.
 * Tools are internal-only (not LLM-visible) and live below Skills in the hierarchy:
 *
 *   LLM → Skill (OpenAI function call) → Tool (external HTTP / DB call)
 *
 * Built-in tools are registered at module init. MCP tools are registered
 * dynamically by McpRegistryService when a provider syncs its schema.
 *
 * Thread safety note: registration happens at startup or via admin actions,
 * not in the hot path. The Map is safe for concurrent reads.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ITool>();

  onModuleInit(): void {
    // Built-in tools are registered via register() calls from IntegrationsModule
    // providers during their own onModuleInit(). This method is intentionally
    // empty — it exists as the lifecycle hook anchor.
    this.logger.log('ToolRegistryService ready');
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" is already registered — overwriting`);
    }
    this.tools.set(tool.name, tool);
    this.logger.debug(`Tool registered: ${tool.name}`);
  }

  registerAll(tools: ITool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  deregister(name: string): void {
    if (this.tools.delete(name)) {
      this.logger.debug(`Tool deregistered: ${name}`);
    }
  }

  /** Deregister all tools whose name starts with a given prefix (e.g. 'mcp:<serverId>:'). */
  deregisterByPrefix(prefix: string): void {
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        this.logger.debug(`Tool deregistered: ${name}`);
      }
    }
  }

  // ─── Lookup ───────────────────────────────────────────────────────────────

  getByName(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ITool[] {
    return [...this.tools.values()];
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }
}
