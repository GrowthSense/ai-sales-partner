import { LlmUsage } from '../dto/llm.dto';

export interface UsageRecord {
  tenantId: string;
  conversationId?: string;
  sessionId?: string;         // AgentSession.id
  providerName: string;
  modelName: string;
  operation: 'chat' | 'embed';
  usage: LlmUsage;
  latencyMs: number;
  timestamp: Date;
}

/**
 * Usage tracking hook — called after every LLM/embedding invocation.
 * Default implementation persists to Redis (rolling 30-day counters) and
 * emits metrics. Swap for a no-op in tests.
 * Bound to LLM_USAGE_TRACKER injection token.
 */
export interface IUsageTracker {
  /**
   * Record a completed LLM or embedding call.
   * Fire-and-forget — never throw; log errors internally.
   */
  record(record: UsageRecord): Promise<void>;

  /**
   * Retrieve aggregated usage for a tenant in a rolling window.
   * Used by billing guards and dashboard endpoints.
   */
  getUsage(
    tenantId: string,
    windowDays: number,
  ): Promise<{ totalTokens: number; totalRequests: number }>;
}
