/**
 * Core skill interface — every built-in skill and MCP-wrapped tool implements this.
 *
 * Skills are selected by the agent via OpenAI function calling.
 * The `parameters` field is a JSON Schema object serialized as the function's
 * parameters spec in the OpenAI tools array.
 */

export type ConversationStage =
  | 'greeting'
  | 'discovery'
  | 'qualification'
  | 'recommendation'
  | 'objection_handling'
  | 'conversion'
  | 'scheduling'
  | 'follow_up';

/**
 * SkillServices — bridge between plain-class skills and NestJS services.
 *
 * The orchestrator populates this object from its injected services and
 * attaches it to SkillContext before calling skills. This keeps skills
 * as plain classes (no DI decorators) while allowing them to call
 * integrations and tools.
 *
 * @example
 *   const link = await ctx.services!.invokeIntegration('calendar', 'getBookingLink', { name, email });
 *   const { crmId } = await ctx.services!.invokeIntegration('crm', 'push', { ...lead });
 */
export interface SkillServices {
  invokeIntegration<T = unknown>(
    type: 'crm' | 'calendar' | 'email' | 'webhook',
    method: string,
    args: Record<string, unknown>,
  ): Promise<T>;

  invokeTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T>;
}

export interface SkillContext {
  tenantId: string;
  conversationId: string;
  agentId: string;
  leadId?: string;
  currentStage: ConversationStage;
  /** Populated by the orchestrator. Absent only in unit tests. */
  services?: SkillServices;
}

export interface SkillSideEffects {
  updateLead?: Record<string, unknown>;
  transitionStage?: ConversationStage;
  sendNotification?: boolean;
  pauseAgent?: boolean;         // used by HandoffToHuman
}

export interface SkillResult {
  success: boolean;
  data: unknown;                // returned verbatim to the LLM as tool result
  sideEffects?: SkillSideEffects;
}

export interface ISkill {
  /** Unique name — matches the function name in OpenAI tools array */
  readonly name: string;

  /** Human-readable description shown to the LLM */
  readonly description: string;

  /** JSON Schema for the skill's input parameters (OpenAI function calling format) */
  readonly parameters: Record<string, unknown>;

  execute(args: unknown, ctx: SkillContext): Promise<SkillResult>;
}
