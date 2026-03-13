import {
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamChunk,
  LlmUsage,
} from '../dto/llm.dto';

/**
 * Core LLM provider abstraction.
 * Swap OpenAI for Anthropic, Gemini, or local Ollama by providing a different
 * implementation bound to the LLM_PROVIDER injection token.
 */
export interface ILlmProvider {
  /**
   * Non-streaming chat completion.
   * Returns the full response once generation is complete.
   */
  complete(request: LlmChatRequest): Promise<LlmChatResponse>;

  /**
   * Streaming chat completion.
   * Yields chunks as they arrive from the provider.
   * The final chunk will have `finishReason` set.
   */
  stream(request: LlmChatRequest): AsyncIterable<LlmStreamChunk>;

  /**
   * Return the usage statistics for the last complete() or stream() call.
   * Called by the UsageTrackerService after each invocation.
   */
  getLastUsage(): LlmUsage | null;

  /**
   * Provider identifier — used in usage tracking records.
   * e.g. 'openai', 'anthropic', 'ollama'
   */
  readonly providerName: string;
}
