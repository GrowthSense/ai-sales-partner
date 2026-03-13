import { Injectable, Logger } from '@nestjs/common';
import { ITool, ToolContext, ToolResult } from '../interfaces/tool.interface';
import { ToolRegistryService } from './tool-registry.service';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ToolAuditEntry {
  toolName: string;
  tenantId: string;
  conversationId?: string;
  callerSkill?: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  timestamp: Date;
}

/**
 * ToolExecutorService
 *
 * Executes registered tools with:
 *  - Timeout enforcement via Promise.race (falls back to tool.timeoutMs or DEFAULT_TIMEOUT_MS)
 *  - Full error containment — never throws; always returns ToolResult
 *  - Audit log hook — pluggable via auditHook (default: structured log)
 *  - Input validation against tool.inputSchema is delegated to the tool itself
 *
 * Usage by skills:
 *   const result = await toolExecutor.execute('crm_push_contact', args, ctx);
 *   if (!result.success) { ... handle error ... }
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  /**
   * Override this to persist audit entries to a DB table or external sink.
   * Default implementation writes a structured debug log.
   */
  auditHook: (entry: ToolAuditEntry) => void | Promise<void> = (entry) => {
    if (entry.success) {
      this.logger.debug(
        `[tool] ${entry.toolName} ok latency=${entry.latencyMs}ms` +
          (entry.callerSkill ? ` caller=${entry.callerSkill}` : ''),
      );
    } else {
      this.logger.warn(
        `[tool] ${entry.toolName} FAILED latency=${entry.latencyMs}ms error=${entry.error}` +
          (entry.callerSkill ? ` caller=${entry.callerSkill}` : ''),
      );
    }
  };

  constructor(private readonly registry: ToolRegistryService) {}

  // ─── Execute by name ──────────────────────────────────────────────────────

  async execute<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult<T>> {
    const tool = this.registry.getByName(toolName);

    if (!tool) {
      const entry: ToolAuditEntry = {
        toolName,
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        callerSkill: ctx.callerSkill,
        success: false,
        latencyMs: 0,
        error: `Tool "${toolName}" is not registered`,
        timestamp: new Date(),
      };
      await this.auditHook(entry);
      return { success: false, data: null as T, latencyMs: 0 };
    }

    return this.executeInstance(tool, args, ctx);
  }

  // ─── Execute a resolved ITool instance ────────────────────────────────────

  async executeInstance<T = unknown>(
    tool: ITool,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult<T>> {
    const startMs = Date.now();
    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool "${tool.name}" timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      );

      const data = (await Promise.race([
        tool.execute(args, ctx),
        timeoutPromise,
      ])) as T;

      const latencyMs = Date.now() - startMs;

      await this.auditHook({
        toolName: tool.name,
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        callerSkill: ctx.callerSkill,
        success: true,
        latencyMs,
        timestamp: new Date(),
      });

      return { success: true, data, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);

      await this.auditHook({
        toolName: tool.name,
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        callerSkill: ctx.callerSkill,
        success: false,
        latencyMs,
        error,
        timestamp: new Date(),
      });

      return { success: false, data: null as T, latencyMs };
    }
  }
}
