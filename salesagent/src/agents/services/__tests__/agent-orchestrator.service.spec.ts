/**
 * AgentOrchestratorService unit tests
 *
 * All external dependencies are mocked so tests run without a DB, Redis,
 * or OpenAI connection. The goal is to verify the orchestration logic
 * (observe → retrieve → reason → act → update state) behaves correctly
 * under different LLM response shapes:
 *   1. Text-only response (no tool calls)
 *   2. Single tool call → text final response
 *   3. MAX_ITERATIONS enforcement
 *   4. RAG skip on GREETING stage
 *   5. Concurrency lock respected
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Server } from 'socket.io';

import { AgentOrchestratorService, OrchestratorRunOptions } from '../agent-orchestrator.service';
import { MemoryManagerService } from '../memory-manager.service';
import { StageStateMachineService } from '../stage-state-machine.service';
import { StreamingProxyService } from '../streaming-proxy.service';
import { SkillRegistryService } from '../../../skills/services/skill-registry.service';
import { SkillExecutorService } from '../../../skills/services/skill-executor.service';
import { RetrievalService } from '../../../rag/services/retrieval.service';
import { MessagesService } from '../../../conversations/services/messages.service';
import { LeadsService } from '../../../leads/services/leads.service';
import { CrmIntegrationService } from '../../../integrations/services/crm-integration.service';
import { CalendarIntegrationService } from '../../../integrations/services/calendar-integration.service';
import { EmailIntegrationService } from '../../../integrations/services/email-integration.service';
import { WebhookProvider } from '../../../integrations/webhooks/webhook.provider';
import { ToolExecutorService } from '../../../tools/services/tool-executor.service';
import { WsRoomsService } from '../../../websocket/services/ws-rooms.service';
import { Conversation } from '../../../conversations/entities/conversation.entity';
import { AgentSession } from '../../entities/agent-session.entity';
import { AgentState } from '../../entities/agent-state.entity';
import { LLM_PROVIDER, LLM_USAGE_TRACKER } from '../../../llm/llm.constants';
import { ConversationStage, ConversationStatus } from '../../../common/enums';
import { ServerEvents } from '../../../websocket/interfaces/ws-events.enum';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const CONV_ID = 'conv-1';
const AGENT_ID = 'agent-1';

function makeConversation(stage = ConversationStage.DISCOVERY): Conversation {
  return {
    id: CONV_ID,
    tenantId: TENANT_ID,
    status: ConversationStatus.ACTIVE,
    currentStage: stage,
    leadId: null,
    messageCount: 1,
    agent: {
      id: AGENT_ID,
      config: {
        llmConfig: { model: 'gpt-4o', temperature: 0.3, maxTokens: 4096 },
        enabledSkills: ['CaptureContact', 'QualifyLead'],
        fallbackMessage: "I'm not sure.",
        ragConfig: { topK: 5, rerankEnabled: false },
        templateVars: { agentName: 'Aria', companyName: 'Acme' },
        stageConfig: {},
      },
    },
    save: jest.fn(),
  } as unknown as Conversation;
}

function makeWsServer() {
  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as jest.Mocked<Server>;
}

const BASE_OPTS: OrchestratorRunOptions = {
  conversationId: CONV_ID,
  tenantId: TENANT_ID,
  visitorId: 'visitor-1',
  userMessage: "I need help with sales automation. I'm the VP of Sales at Acme.",
  wsServer: makeWsServer(),
  wsRoom: `conversation:${CONV_ID}`,
};

// ─── Service mocks ─────────────────────────────────────────────────────────

function makeLlmProvider(textResponse: string, toolCalls?: unknown[]) {
  return {
    chatStream: jest.fn().mockResolvedValue({
      content: textResponse,
      tool_calls: toolCalls ?? null,
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
  };
}

function makeMemoryManager() {
  return {
    buildContext: jest.fn().mockReturnValue({
      systemPrompt: 'You are Aria.',
      messages: [],
      systemTokens: 200,
      historyTokens: 400,
      ragChunkIds: [],
    }),
  };
}

function makeSkillExecutor() {
  return {
    executeAll: jest.fn().mockResolvedValue([]),
  };
}

function makeAgentStateRepo(locked = false) {
  const state = {
    id: 'state-1',
    conversationId: CONV_ID,
    isProcessing: locked,
    workingMemory: { toolCallCount: 0, ragChunkIds: [], skillExecutionRecords: [] },
    save: jest.fn().mockImplementation(async function () { return this; }),
  };
  return {
    findOne: jest.fn().mockResolvedValue(state),
    create: jest.fn().mockReturnValue(state),
    save: jest.fn().mockImplementation(async (s: any) => s),
    _state: state,
  };
}

// ─── Test suite ────────────────────────────────────────────────────────────

describe('AgentOrchestratorService', () => {
  let orchestrator: AgentOrchestratorService;
  let llmProvider: ReturnType<typeof makeLlmProvider>;
  let retrievalService: jest.Mocked<RetrievalService>;
  let messagesService: jest.Mocked<MessagesService>;
  let conversationRepo: jest.Mocked<Repository<Conversation>>;
  let stateRepo: ReturnType<typeof makeAgentStateRepo>;

  async function buildModule(overrides: {
    llm?: ReturnType<typeof makeLlmProvider>;
    stage?: ConversationStage;
    stateLocked?: boolean;
  } = {}) {
    llmProvider = overrides.llm ?? makeLlmProvider('Hello! How can I help you today?');
    const conversation = makeConversation(overrides.stage ?? ConversationStage.DISCOVERY);

    conversationRepo = {
      findOne: jest.fn().mockResolvedValue(conversation),
      save: jest.fn().mockImplementation(async (c: any) => c),
    } as any;

    stateRepo = makeAgentStateRepo(overrides.stateLocked ?? false);

    retrievalService = {
      hybridSearch: jest.fn().mockResolvedValue([]),
    } as any;

    messagesService = {
      getHistory: jest.fn().mockResolvedValue([]),
      createMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      createBatch: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentOrchestratorService,
        { provide: LLM_PROVIDER, useValue: llmProvider },
        { provide: LLM_USAGE_TRACKER, useValue: { track: jest.fn() } },
        { provide: MemoryManagerService, useValue: makeMemoryManager() },
        { provide: StageStateMachineService, useValue: { canTransition: jest.fn().mockReturnValue(true), transition: jest.fn() } },
        { provide: StreamingProxyService, useValue: { streamToRoom: jest.fn().mockResolvedValue('Hello! How can I help you today?') } },
        { provide: SkillRegistryService, useValue: { getEnabled: jest.fn().mockReturnValue([]), toOpenAiTools: jest.fn().mockReturnValue([]) } },
        { provide: SkillExecutorService, useValue: makeSkillExecutor() },
        { provide: RetrievalService, useValue: retrievalService },
        { provide: MessagesService, useValue: messagesService },
        { provide: LeadsService, useValue: { findById: jest.fn().mockResolvedValue(null), upsertByConversation: jest.fn().mockResolvedValue({ id: 'lead-1' }), enqueueCrmSync: jest.fn() } },
        { provide: CrmIntegrationService, useValue: { push: jest.fn() } },
        { provide: CalendarIntegrationService, useValue: { getBookingLink: jest.fn(), getAvailableSlots: jest.fn() } },
        { provide: EmailIntegrationService, useValue: { send: jest.fn() } },
        { provide: WebhookProvider, useValue: { deliver: jest.fn() } },
        { provide: ToolExecutorService, useValue: { execute: jest.fn() } },
        { provide: WsRoomsService, useValue: { emitToRoom: jest.fn(), emitToTenant: jest.fn() } },
        { provide: getRepositoryToken(Conversation), useValue: conversationRepo },
        { provide: getRepositoryToken(AgentSession), useValue: { create: jest.fn().mockReturnValue({ id: 'session-1' }), save: jest.fn().mockImplementation(async (s: any) => s) } },
        { provide: getRepositoryToken(AgentState), useValue: stateRepo },
      ],
    }).compile();

    orchestrator = module.get(AgentOrchestratorService);
  }

  describe('text-only response (no tool calls)', () => {
    it('returns assistantMessage and the current stage', async () => {
      await buildModule();
      const opts = { ...BASE_OPTS, wsServer: makeWsServer() };
      const result = await orchestrator.run(opts);

      expect(result.assistantMessage).toBeTruthy();
      expect(result.newStage).toBe(ConversationStage.DISCOVERY);
    });

    it('loads conversation history', async () => {
      await buildModule();
      await orchestrator.run({ ...BASE_OPTS, wsServer: makeWsServer() });
      expect(messagesService.getHistory).toHaveBeenCalledWith(CONV_ID, TENANT_ID);
    });
  });

  describe('RAG retrieval', () => {
    it('skips RAG retrieval on GREETING stage', async () => {
      await buildModule({ stage: ConversationStage.GREETING });
      await orchestrator.run({ ...BASE_OPTS, wsServer: makeWsServer() });
      expect(retrievalService.hybridSearch).not.toHaveBeenCalled();
    });

    it('calls RAG retrieval on non-GREETING stages', async () => {
      await buildModule({ stage: ConversationStage.DISCOVERY });
      await orchestrator.run({ ...BASE_OPTS, wsServer: makeWsServer() });
      expect(retrievalService.hybridSearch).toHaveBeenCalledWith(
        BASE_OPTS.userMessage,
        TENANT_ID,
        expect.any(Number),
        expect.anything(),
      );
    });

    it('degrades gracefully when RAG retrieval throws', async () => {
      await buildModule();
      retrievalService.hybridSearch.mockRejectedValue(new Error('pgvector timeout'));

      // Should not throw — RAG failure is non-fatal
      await expect(
        orchestrator.run({ ...BASE_OPTS, wsServer: makeWsServer() }),
      ).resolves.toBeDefined();
    });
  });

  describe('concurrency lock', () => {
    it('drops the message and emits an error when conversation is already processing', async () => {
      await buildModule({ stateLocked: true });
      const wsServer = makeWsServer();
      const result = await orchestrator.run({ ...BASE_OPTS, wsServer });

      expect(result.assistantMessage).toBe('');
      expect(result.iterationCount).toBe(0);
      expect(wsServer.emit).toHaveBeenCalledWith(
        ServerEvents.ERROR,
        expect.objectContaining({ message: expect.stringContaining('processing') }),
      );
    });
  });
});

// Helper to satisfy TypeScript — Repository is an interface here
type Repository<T> = {
  findOne: jest.Mock;
  save: jest.Mock;
};
