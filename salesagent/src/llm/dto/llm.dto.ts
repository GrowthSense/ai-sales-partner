/**
 * Provider-agnostic DTOs for the LLM abstraction layer.
 *
 * These types mirror the OpenAI messages API shape closely so that the OpenAI
 * provider implementation is thin, but they are NOT tied to the OpenAI SDK
 * types — any provider can map to/from these.
 */

// ─── Tool / Function Calling ────────────────────────────────────────────────

export interface LlmToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: LlmToolParameterSchema;
    /** strict: true enables OpenAI Structured Outputs mode for function args */
    strict?: boolean;
  };
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** Raw JSON string — parse before use */
    arguments: string;
  };
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface LlmSystemMessage {
  role: 'system';
  content: string;
}

export interface LlmUserMessage {
  role: 'user';
  content: string;
}

export interface LlmAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: LlmToolCall[];
}

export interface LlmToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export type LlmMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolResultMessage;

// ─── Response Format (Structured Outputs) ────────────────────────────────────

export interface LlmJsonSchemaFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface LlmJsonObjectFormat {
  type: 'json_object';
}

export type LlmResponseFormat = LlmJsonSchemaFormat | LlmJsonObjectFormat;

// ─── Chat Request / Response ─────────────────────────────────────────────────

export interface LlmChatRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** Controls which tool (if any) the model should call. */
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  response_format?: LlmResponseFormat;
  /** Pass through to provider if needed (e.g. user ID for abuse tracking). */
  user?: string;
}

export type LlmFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | null;

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmChatResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: LlmFinishReason;
  usage: LlmUsage;
}

// ─── Streaming ───────────────────────────────────────────────────────────────

export interface LlmStreamChunk {
  /** Incremental text content. Empty string during tool call accumulation. */
  delta: string;
  /** Incremental tool call fragment, if the model is building a tool call. */
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  /**
   * Non-null on the final chunk only.
   * The consumer should call getLastUsage() after finishReason is received.
   */
  finishReason: LlmFinishReason;
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  /** Truncate to this many dimensions (text-embedding-3-* supports this). */
  dimensions?: number;
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}
