import { Injectable, Logger } from '@nestjs/common';
import { SkillRegistryService } from './skill-registry.service';
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillSideEffects,
} from '../interfaces/skill.interface';
import { LlmToolCall } from '../../llm/dto/llm.dto';

export interface ExecutionRecord {
  skillName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  latencyMs: number;
  success: boolean;
}

/**
 * SkillExecutorService
 *
 * Executes a skill invocation from an LLM tool call:
 *  1. Look up skill in the registry (fail gracefully if not found)
 *  2. Parse + validate args (JSON parse, basic required-field check)
 *  3. Call skill.execute(args, ctx)
 *  4. Return result and side-effects for the orchestrator to apply
 *
 * The orchestrator applies side-effects (updateLead, transitionStage, etc.)
 * after collecting all tool results for a single iteration, keeping
 * responsibility for state mutation in one place.
 */
@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger(SkillExecutorService.name);

  constructor(private readonly registry: SkillRegistryService) {}

  /**
   * Execute a single tool call from the LLM.
   *
   * Always returns a SkillResult — never throws.
   * On error, returns { success: false, data: errorMessage } so the
   * LLM can see the failure and decide what to do next.
   */
  async execute(
    toolCall: LlmToolCall,
    ctx: SkillContext,
  ): Promise<{ result: SkillResult; record: ExecutionRecord }> {
    const { function: fn } = toolCall;
    const start = Date.now();

    const skill = this.registry.getByName(fn.name);
    if (!skill) {
      const msg = `Unknown skill: ${fn.name}`;
      this.logger.warn(msg);
      const errorResult: SkillResult = { success: false, data: msg };
      return {
        result: errorResult,
        record: this.makeRecord(fn.name, {}, errorResult, start, false),
      };
    }

    // Parse JSON arguments
    let args: Record<string, unknown>;
    try {
      args = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch {
      const msg = `Invalid JSON args for skill ${fn.name}: ${fn.arguments}`;
      this.logger.warn(msg);
      const errorResult: SkillResult = { success: false, data: msg };
      return {
        result: errorResult,
        record: this.makeRecord(fn.name, {}, errorResult, start, false),
      };
    }

    // Validate required parameters from skill's JSON schema
    const validationError = this.validateArgs(skill, args);
    if (validationError) {
      this.logger.warn(`Skill ${fn.name} arg validation failed: ${validationError}`);
      const errorResult: SkillResult = { success: false, data: validationError };
      return {
        result: errorResult,
        record: this.makeRecord(fn.name, args, errorResult, start, false),
      };
    }

    // Execute
    try {
      this.logger.debug(`Executing skill: ${fn.name} (conv: ${ctx.conversationId})`);
      const result = await skill.execute(args, ctx);
      const record = this.makeRecord(fn.name, args, result, start, result.success);
      return { result, record };
    } catch (err) {
      const msg = `Skill ${fn.name} threw an error: ${(err as Error).message}`;
      this.logger.error(msg, (err as Error).stack);
      const errorResult: SkillResult = { success: false, data: msg };
      return {
        result: errorResult,
        record: this.makeRecord(fn.name, args, errorResult, start, false),
      };
    }
  }

  /**
   * Execute all tool calls from one LLM iteration in parallel.
   * Returns results in the same order as the input tool calls.
   */
  async executeAll(
    toolCalls: LlmToolCall[],
    ctx: SkillContext,
  ): Promise<{ result: SkillResult; record: ExecutionRecord; toolCallId: string; toolName: string }[]> {
    return Promise.all(
      toolCalls.map(async (tc) => {
        const { result, record } = await this.execute(tc, ctx);
        return { result, record, toolCallId: tc.id, toolName: tc.function.name };
      }),
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Minimal required-field validation based on the skill's JSON Schema.
   * Returns an error string, or null if valid.
   * Full AJV validation can be added here without changing the interface.
   */
  private validateArgs(skill: ISkill, args: Record<string, unknown>): string | null {
    const params = skill.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    if (!params.required) return null;

    const missing = params.required.filter((field) => args[field] === undefined);
    if (missing.length > 0) {
      return `Missing required fields for ${skill.name}: ${missing.join(', ')}`;
    }
    return null;
  }

  private makeRecord(
    skillName: string,
    args: Record<string, unknown>,
    result: SkillResult,
    startMs: number,
    success: boolean,
  ): ExecutionRecord {
    return {
      skillName,
      args,
      result: result.data as Record<string, unknown>,
      latencyMs: Date.now() - startMs,
      success,
    };
  }
}
