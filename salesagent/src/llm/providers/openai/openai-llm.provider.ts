import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import { ILlmProvider } from '../../interfaces/llm-provider.interface';
import {
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamChunk,
  LlmToolCall,
  LlmUsage,
  LlmMessage,
  LlmTool,
} from '../../dto/llm.dto';

/**
 * OpenAI implementation of ILlmProvider.
 *
 * Supports:
 * - Non-streaming chat completions
 * - Server-Sent Events streaming (AsyncIterable)
 * - Tool / function calling (parallel and sequential)
 * - Structured Outputs via response_format.json_schema (strict mode)
 * - Automatic retry on 429 / 5xx (handled by the openai SDK's built-in retry)
 */
@Injectable()
export class OpenAiLlmProvider implements ILlmProvider {
  readonly providerName = 'openai';

  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private lastUsage: LlmUsage | null = null;

  constructor(private readonly config: ConfigService) {
    const openRouterKey = this.config.get<string>('OPENROUTER_API_KEY');
    const useOpenRouter = !!openRouterKey;
    this.client = new OpenAI({
      apiKey: useOpenRouter ? openRouterKey : this.config.getOrThrow<string>('OPENAI_API_KEY'),
      baseURL: useOpenRouter
        ? 'https://openrouter.ai/api/v1'
        : (this.config.get<string>('OPENAI_BASE_URL') || undefined),
      maxRetries: 3,
      timeout: 60_000,
      defaultHeaders: useOpenRouter
        ? { 'HTTP-Referer': 'https://salesagent.local', 'X-Title': 'Salesagent' }
        : undefined,
    });
  }

  // ─── ILlmProvider ────────────────────────────────────────────────────────

  getLastUsage(): LlmUsage | null {
    return this.lastUsage;
  }

  async complete(request: LlmChatRequest): Promise<LlmChatResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: this.toOpenAiMessages(request.messages),
      tools: request.tools ? this.toOpenAiTools(request.tools) : undefined,
      tool_choice: request.tool_choice as never,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      response_format: request.response_format as never,
      user: request.user,
      stream: false,
    });

    const choice = response.choices[0];
    const usage: LlmUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };
    this.lastUsage = usage;

    return {
      id: response.id,
      model: response.model,
      content: choice.message.content ?? null,
      toolCalls: this.fromOpenAiToolCalls((choice.message.tool_calls ?? []) as any),
      finishReason: choice.finish_reason as LlmChatResponse['finishReason'],
      usage,
    };
  }

  async *stream(request: LlmChatRequest): AsyncIterable<LlmStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: this.toOpenAiMessages(request.messages),
      tools: request.tools ? this.toOpenAiTools(request.tools) : undefined,
      tool_choice: request.tool_choice as never,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      response_format: request.response_format as never,
      user: request.user,
      stream: true,
      stream_options: { include_usage: true },
    });

    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      // Usage arrives on the final chunk (stream_options.include_usage)
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
        this.lastUsage = {
          promptTokens,
          completionTokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }

      if (!choice) continue;

      const delta = choice.delta;
      const finishReason = (choice.finish_reason as LlmStreamChunk['finishReason']) ?? null;

      // Text delta
      if (delta.content) {
        yield { delta: delta.content, finishReason };
        continue;
      }

      // Tool call delta — accumulate by index
      if (delta.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          yield {
            delta: '',
            toolCallDelta: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
            finishReason,
          };
        }
        continue;
      }

      // Final chunk with no content (finish_reason present)
      if (finishReason) {
        yield { delta: '', finishReason };
      }
    }
  }

  // ─── Mapping helpers ─────────────────────────────────────────────────────

  private toOpenAiMessages(messages: LlmMessage[]): ChatCompletionMessageParam[] {
    return messages.map((msg): ChatCompletionMessageParam => {
      switch (msg.role) {
        case 'system':
          return { role: 'system', content: msg.content };
        case 'user':
          return { role: 'user', content: msg.content };
        case 'assistant':
          return {
            role: 'assistant',
            content: msg.content ?? null,
            tool_calls: msg.tool_calls?.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          };
        case 'tool':
          return {
            role: 'tool',
            tool_call_id: msg.tool_call_id,
            content: msg.content,
          };
      }
    });
  }

  private toOpenAiTools(tools: LlmTool[]): ChatCompletionTool[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as never,
        strict: t.function.strict,
      },
    }));
  }

  private fromOpenAiToolCalls(
    toolCalls: NonNullable<ChatCompletionChunk.Choice.Delta['tool_calls']>,
  ): LlmToolCall[] {
    return toolCalls.map((tc) => ({
      id: tc.id ?? '',
      type: 'function' as const,
      function: {
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '',
      },
    }));
  }
}
