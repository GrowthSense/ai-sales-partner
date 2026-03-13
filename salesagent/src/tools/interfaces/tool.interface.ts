/**
 * ITool — the low-level callable action interface.
 *
 * Tools sit below Skills in the capability hierarchy:
 *
 *   LLM → selects Skill (via function calling) → Skill may call Tool → external API
 *
 * Unlike Skills (which have LLM-facing descriptions), Tools are internal
 * infrastructure — not directly visible to the LLM. They wrap external HTTP
 * calls, database lookups, or MCP proxy calls behind a uniform execute() contract.
 *
 * Skills that need external calls receive a ToolInvoker via SkillContext.services.
 * The orchestrator creates the invoker closure and populates it before calling skills.
 */

export interface ToolContext {
  tenantId: string;
  conversationId?: string;
  callerSkill?: string; // for audit logs
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data: T;
  latencyMs: number;
}

export interface ITool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Unique name within the tenant tool registry. */
  readonly name: string;

  /** Short description for logging/admin UI. NOT shown to LLM. */
  readonly description: string;

  /** Timeout in milliseconds. Executor enforces this via Promise.race. */
  readonly timeoutMs: number;

  /** JSON Schema for input validation. */
  readonly inputSchema: Record<string, unknown>;

  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

/**
 * SkillServices — the bridge between plain-class skills and NestJS services.
 *
 * The orchestrator creates this object from the injected services and passes
 * it to skills via SkillContext.services. Skills call these methods without
 * needing DI themselves (keeping them as plain classes without decorators).
 */
export interface SkillServices {
  /**
   * Invoke an integration (CRM, calendar, email, webhook) by type and method.
   * The orchestrator dispatches to the correct IntegrationService internally.
   *
   * @example
   *   await ctx.services.invokeIntegration('calendar', 'getBookingLink', { meetingType: 'demo' })
   */
  invokeIntegration<T = unknown>(
    type: 'crm' | 'calendar' | 'email' | 'webhook',
    method: string,
    args: Record<string, unknown>,
  ): Promise<T>;

  /**
   * Invoke a registered Tool by name (built-in or MCP-synced).
   * Goes through ToolExecutorService (timeout + audit logging).
   *
   * @example
   *   await ctx.services.invokeTool('inventory_check', { productId: 'xyz' })
   */
  invokeTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T>;
}
