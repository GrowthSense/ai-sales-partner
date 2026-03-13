import { MemoryManagerService } from '../memory-manager.service';
import { PromptBuilderService } from '../../prompts/prompt-builder.service';
import { ConversationStage } from '../../../common/enums';
import { ConversationMessage } from '../../../conversations/entities/conversation-message.entity';
import { AgentConfig } from '../../entities/agent-config.entity';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(
  role: 'user' | 'assistant' | 'tool',
  content: string,
  tokenCount?: number,
): ConversationMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role,
    content,
    tokenCount: tokenCount ?? null,
    toolCalls: undefined,
    toolCallId: undefined,
    conversationId: 'conv-1',
    createdAt: new Date(),
  } as unknown as ConversationMessage;
}

function makeConfig(model = 'gpt-4o'): AgentConfig {
  return {
    llmConfig: { model, temperature: 0.3, maxTokens: 4096 },
    fallbackMessage: "I'm not sure — let me connect you with our team.",
    templateVars: { agentName: 'Aria', companyName: 'Acme Corp' },
    stageConfig: {},
  } as unknown as AgentConfig;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MemoryManagerService', () => {
  let service: MemoryManagerService;
  let promptBuilder: jest.Mocked<PromptBuilderService>;

  beforeEach(() => {
    promptBuilder = {
      buildSystemPrompt: jest.fn().mockReturnValue('system-prompt-text'),
    } as unknown as jest.Mocked<PromptBuilderService>;

    service = new MemoryManagerService(promptBuilder);
  });

  describe('buildContext', () => {
    it('returns the system prompt from PromptBuilderService', () => {
      const ctx = service.buildContext({
        config: makeConfig(),
        currentStage: ConversationStage.GREETING,
        history: [],
        lead: null,
        ragChunks: [],
      });

      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledOnce?.() ??
        expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledTimes(1);
      expect(ctx.systemPrompt).toBe('system-prompt-text');
    });

    it('returns an empty messages array for empty history', () => {
      const ctx = service.buildContext({
        config: makeConfig(),
        currentStage: ConversationStage.DISCOVERY,
        history: [],
        lead: null,
        ragChunks: [],
      });

      expect(ctx.messages).toHaveLength(0);
    });

    it('includes ragChunkIds from the provided chunks', () => {
      const ragChunks = [
        { chunkId: 'chunk-a', content: 'Pricing info', documentId: 'doc-1', metadata: { documentTitle: 'Pricing' }, semanticScore: 0.9, keywordScore: 0, fusedScore: 0.9 },
        { chunkId: 'chunk-b', content: 'Feature info', documentId: 'doc-1', metadata: { documentTitle: 'Features' }, semanticScore: 0.8, keywordScore: 0, fusedScore: 0.8 },
      ];

      const ctx = service.buildContext({
        config: makeConfig(),
        currentStage: ConversationStage.RECOMMENDATION,
        history: [],
        lead: null,
        ragChunks,
      });

      expect(ctx.ragChunkIds).toEqual(['chunk-a', 'chunk-b']);
    });

    it('returns systemTokens > 0 for a non-empty system prompt', () => {
      promptBuilder.buildSystemPrompt.mockReturnValue('a'.repeat(380)); // ~100 tokens at 3.8 chars/token
      const ctx = service.buildContext({
        config: makeConfig(),
        currentStage: ConversationStage.GREETING,
        history: [],
        lead: null,
        ragChunks: [],
      });

      expect(ctx.systemTokens).toBeGreaterThan(0);
    });
  });

  describe('trimHistory', () => {
    it('returns the full history when it fits within the budget', () => {
      const msgs = Array.from({ length: 10 }, (_, i) =>
        makeMessage('user', 'hello world', 10),
      );
      const trimmed = service.trimHistory(msgs, 10_000);
      expect(trimmed).toHaveLength(10);
    });

    it('trims oldest messages when budget is exhausted', () => {
      // 100 messages × 100 tokens each = 10,000 tokens; budget = 2,000
      const msgs = Array.from({ length: 100 }, (_, i) =>
        makeMessage('user', `msg-${i}`, 100),
      );
      const trimmed = service.trimHistory(msgs, 2_000);
      expect(trimmed.length).toBeLessThan(100);
      // Last message should still be present
      expect(trimmed[trimmed.length - 1].content).toBe('msg-99');
    });

    it('never trims below MIN_HISTORY_MESSAGES (20)', () => {
      const msgs = Array.from({ length: 30 }, (_, i) =>
        makeMessage('user', `msg-${i}`, 500), // 500 tokens each — tight budget
      );
      const trimmed = service.trimHistory(msgs, 1_000); // budget forces trimming
      expect(trimmed.length).toBeGreaterThanOrEqual(20);
    });

    it('returns empty array for empty history', () => {
      expect(service.trimHistory([], 10_000)).toHaveLength(0);
    });

    it('removes leading tool messages to avoid orphaned tool results', () => {
      const msgs = [
        makeMessage('tool', '{"result":"ok"}', 20),
        makeMessage('assistant', 'Great, I booked it.', 20),
        makeMessage('user', 'Thanks!', 10),
      ];
      // Force trimming by using a tiny budget (but still >= MIN_HISTORY_MESSAGES floor)
      // Use a budget just large enough for 2 messages to trigger the leading-tool strip
      const trimmed = service.trimHistory(msgs, 50_000); // no trim needed — all fit
      // All messages fit — no leading tool strip needed here
      expect(trimmed[0].role).not.toBe('tool');
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens proportional to text length', () => {
      const tokens380 = service.estimateTokens('a'.repeat(380));
      const tokens760 = service.estimateTokens('a'.repeat(760));
      // 760 chars should produce roughly double the tokens
      expect(tokens760).toBeCloseTo(tokens380 * 2, 0);
    });

    it('returns 0 for an empty string', () => {
      expect(service.estimateTokens('')).toBe(0);
    });
  });
});
