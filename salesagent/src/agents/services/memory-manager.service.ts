import { Injectable, Logger } from '@nestjs/common';
import { ConversationStage } from '../../common/enums';
import { AgentConfig } from '../entities/agent-config.entity';
import { ConversationMessage } from '../../conversations/entities/conversation-message.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { RetrievalResult } from '../../rag/interfaces/retrieval-result.interface';
import { LlmMessage } from '../../llm/dto/llm.dto';
import { PromptBuilderService } from '../prompts/prompt-builder.service';

// ConversationStage is used by buildContext opts type (passed through to PromptBuilderService)

/**
 * Token budget allocation (GPT-4o, 128K context window):
 *
 *  System prompt (persona + stage + lead + RAG):  ~5 000 tokens
 *  History (rolling window):                      ~80 000 tokens
 *  Response reserve (max_tokens):                  ~4 096 tokens
 *  Safety buffer:                                 remaining
 *
 * History trimming removes oldest messages (never the system prompt)
 * when the total approaches 80% of the window.
 */

const MODEL_CONTEXT_WINDOW: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_385,
};
const DEFAULT_CONTEXT_WINDOW = 128_000;
const HISTORY_BUDGET_FRACTION = 0.625; // ~80K of 128K
const MIN_HISTORY_MESSAGES = 20;
const CHARS_PER_TOKEN = 3.8; // heuristic; swap for js-tiktoken for exactness

export interface AssembledContext {
  systemPrompt: string;
  messages: LlmMessage[];
  systemTokens: number;
  historyTokens: number;
  ragChunkIds: string[];
}

@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);

  constructor(private readonly promptBuilder: PromptBuilderService) {}

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Assemble a complete, token-budgeted context for one agent turn.
   * Returns:
   *  - systemPrompt  : pass as messages[0].content (role: system)
   *  - messages      : trimmed history ready for LLM
   *  - ragChunkIds   : logged in AgentState.workingMemory for debuggability
   */
  buildContext(opts: {
    config: AgentConfig;
    currentStage: ConversationStage;
    history: ConversationMessage[];
    lead: Lead | null;
    ragChunks: RetrievalResult[];
  }): AssembledContext {
    const { config, currentStage, history, lead, ragChunks } = opts;

    const systemPrompt = this.promptBuilder.buildSystemPrompt(config, currentStage, lead, ragChunks);
    const systemTokens = this.estimateTokens(systemPrompt);

    const contextWindow = MODEL_CONTEXT_WINDOW[config.llmConfig.model] ?? DEFAULT_CONTEXT_WINDOW;
    const historyBudget = Math.floor(contextWindow * HISTORY_BUDGET_FRACTION);

    const trimmedHistory = this.trimHistory(history, historyBudget);
    const historyTokens = trimmedHistory.reduce(
      (sum, m) => sum + (m.tokenCount || this.estimateTokens(this.messageToText(m))),
      0,
    );

    this.logger.debug(
      `Context: system=${systemTokens}t history=${historyTokens}t ` +
      `msgs=${trimmedHistory.length}/${history.length} chunks=${ragChunks.length}`,
    );

    return {
      systemPrompt,
      messages: this.toOpenAiMessages(trimmedHistory),
      systemTokens,
      historyTokens,
      ragChunkIds: ragChunks.map((c) => c.chunkId),
    };
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  // ─── History trimming ─────────────────────────────────────────────────────

  /**
   * Trim message history to fit within budgetTokens.
   *
   * Algorithm:
   *  1. Walk from newest → oldest, accumulating token counts.
   *  2. Stop when budget is exhausted AND we have >= MIN_HISTORY_MESSAGES.
   *  3. Never start with a tool message (orphaned tool result breaks OpenAI API).
   */
  trimHistory(history: ConversationMessage[], budgetTokens: number): ConversationMessage[] {
    if (history.length === 0) return [];

    const totalTokens = history.reduce(
      (sum, m) => sum + (m.tokenCount || this.estimateTokens(this.messageToText(m))),
      0,
    );
    if (totalTokens <= budgetTokens) return history; // fast path

    let usedTokens = 0;
    const kept: ConversationMessage[] = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const tokens = msg.tokenCount || this.estimateTokens(this.messageToText(msg));

      if (usedTokens + tokens > budgetTokens && kept.length >= MIN_HISTORY_MESSAGES) break;

      kept.unshift(msg);
      usedTokens += tokens;
    }

    // Remove leading tool messages (orphaned without their assistant call)
    while (kept.length > 0 && kept[0].role === 'tool') kept.shift();

    this.logger.debug(`History trimmed: ${history.length} → ${kept.length} messages`);
    return kept;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private toOpenAiMessages(messages: ConversationMessage[]): LlmMessage[] {
    return messages.map((msg): LlmMessage => {
      if (msg.role === 'assistant') {
        return {
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls?.length ? msg.toolCalls : undefined,
        };
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId ?? '',
          content: msg.content ?? '',
        };
      }
      return { role: msg.role as 'user' | 'system', content: msg.content ?? '' };
    });
  }

  private messageToText(msg: ConversationMessage): string {
    return (msg.content ?? '') + (msg.toolCalls ? JSON.stringify(msg.toolCalls) : '');
  }
}
