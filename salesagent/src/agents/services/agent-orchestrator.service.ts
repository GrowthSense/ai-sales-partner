import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server } from 'socket.io';

import { LLM_PROVIDER, LLM_USAGE_TRACKER } from '../../llm/llm.constants';
import { ILlmProvider } from '../../llm/interfaces/llm-provider.interface';
import { IUsageTracker } from '../../llm/interfaces/usage-tracker.interface';
import { LlmMessage, LlmChatRequest } from '../../llm/dto/llm.dto';

import { MemoryManagerService } from './memory-manager.service';
import { StageStateMachineService } from './stage-state-machine.service';
import { StreamingProxyService } from './streaming-proxy.service';

import { SkillRegistryService } from '../../skills/services/skill-registry.service';
import { SkillExecutorService, ExecutionRecord } from '../../skills/services/skill-executor.service';
import { SkillContext, SkillServices } from '../../skills/interfaces/skill.interface';

import { RetrievalService } from '../../rag/services/retrieval.service';

import { MessagesService, CreateMessageDto } from '../../conversations/services/messages.service';
import { LeadsService } from '../../leads/services/leads.service';

import { CrmIntegrationService } from '../../integrations/services/crm-integration.service';
import { CalendarIntegrationService } from '../../integrations/services/calendar-integration.service';
import { EmailIntegrationService } from '../../integrations/services/email-integration.service';
import { WebhookProvider } from '../../integrations/webhooks/webhook.provider';
import { ToolExecutorService } from '../../tools/services/tool-executor.service';

import { Conversation } from '../../conversations/entities/conversation.entity';
import { AgentSession } from '../entities/agent-session.entity';
import { AgentState, WorkingMemory } from '../entities/agent-state.entity';
import { Lead } from '../../leads/entities/lead.entity';

import {
  ConversationStage,
  ConversationStatus,
  AgentSessionStatus,
  MessageRole,
} from '../../common/enums';
import { ServerEvents } from '../../websocket/interfaces/ws-events.enum';
import { WsRoomsService } from '../../websocket/services/ws-rooms.service';

/**
 * Hard limit on tool-call iterations per turn.
 * Prevents runaway loops: user message → tool → tool → … → final text
 * For most turns: 1-2 iterations. 3 allows e.g. QualifyLead + CaptureContact + TransitionStage.
 */
const MAX_ITERATIONS = 3;

/**
 * Stages where RAG retrieval is skipped.
 * GREETING is intentionally NOT in this set — visitors often ask product
 * questions on their very first message and need knowledge context immediately.
 */
const RAG_SKIP_STAGES = new Set<ConversationStage>();

export interface OrchestratorRunOptions {
  conversationId: string;
  tenantId: string;
  visitorId: string;
  userMessage: string;
  /** Socket.io server — needed to stream tokens and emit events to the room. */
  wsServer: Server;
  /** Socket.io room name, e.g. 'conversation:<id>' */
  wsRoom: string;
}

export interface OrchestratorRunResult {
  assistantMessage: string;
  newStage: ConversationStage;
  leadId: string | null;
  sessionId: string;
  iterationCount: number;
}

/**
 * AgentOrchestratorService — the central reasoning loop.
 *
 * Called once per user message (from ConversationsGateway or the BullMQ
 * agent-response worker as an async fallback).
 *
 * Full loop: OBSERVE → RETRIEVE → REASON → ACT → UPDATE STATE
 *
 *  OBSERVE   Load conversation, agent config, lead, message history, agent state
 *  RETRIEVE  Hybrid RAG search for relevant knowledge chunks
 *  REASON    Assemble context, call LLM with skills as tools (streaming)
 *  ACT       Execute skill tool calls (up to MAX_ITERATIONS rounds)
 *  UPDATE    Persist messages, update stage/lead/conversation, emit WS events
 */
@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    // ── LLM abstraction (swappable via injection token) ───────────────────
    @Inject(LLM_PROVIDER) private readonly llm: ILlmProvider,
    @Inject(LLM_USAGE_TRACKER) private readonly usageTracker: IUsageTracker,

    // ── Context assembly & streaming ──────────────────────────────────────
    private readonly memoryManager: MemoryManagerService,
    private readonly stageMachine: StageStateMachineService,
    private readonly streamingProxy: StreamingProxyService,

    // ── Skill execution ───────────────────────────────────────────────────
    private readonly skillRegistry: SkillRegistryService,
    private readonly skillExecutor: SkillExecutorService,

    // ── RAG retrieval ─────────────────────────────────────────────────────
    private readonly retrieval: RetrievalService,

    // ── Data services ─────────────────────────────────────────────────────
    private readonly messages: MessagesService,
    private readonly leads: LeadsService,

    // ── Integration services (injected via SkillServices bridge) ─────────
    private readonly crmIntegration: CrmIntegrationService,
    private readonly calendarIntegration: CalendarIntegrationService,
    private readonly emailIntegration: EmailIntegrationService,
    private readonly webhookProvider: WebhookProvider,
    private readonly toolExecutor: ToolExecutorService,

    // ── WebSocket room emitter (WsRoomsService exported from WebsocketModule) ─
    private readonly wsRooms: WsRoomsService,

    // ── Repositories for direct reads/updates ────────────────────────────
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(AgentSession)
    private readonly sessionRepo: Repository<AgentSession>,

    @InjectRepository(AgentState)
    private readonly stateRepo: Repository<AgentState>,
  ) {}

  // ─── Public entry point ──────────────────────────────────────────────────

  async run(opts: OrchestratorRunOptions): Promise<OrchestratorRunResult> {
    const wallStart = Date.now();

    // ══════════════════════════════════════════════════════════════════════
    // 1. OBSERVE — load all context needed for this turn
    // ══════════════════════════════════════════════════════════════════════
    const conversation = await this.loadConversation(opts.conversationId, opts.tenantId);

    // Concurrency guard: one agent turn at a time per conversation
    const agentState = await this.acquireLock(conversation, opts.tenantId);
    if (!agentState) {
      this.logger.warn(`Conversation ${opts.conversationId} is already processing — dropping message`);
      opts.wsServer.to(opts.wsRoom).emit(ServerEvents.ERROR, {
        message: 'Agent is still processing the previous message. Please wait.',
      });
      // Return a placeholder — the caller should not persist this
      return {
        assistantMessage: '',
        newStage: conversation.currentStage,
        leadId: conversation.leadId,
        sessionId: '',
        iterationCount: 0,
      };
    }

    const agentConfig = conversation.agent?.config;
    if (!agentConfig) {
      await this.releaseLock(agentState);
      throw new Error(`Agent config missing for conversation ${opts.conversationId}`);
    }

    const [history, lead] = await Promise.all([
      this.messages.getHistory(opts.conversationId, opts.tenantId),
      conversation.leadId
        ? this.leads.findById(conversation.leadId, opts.tenantId)
        : Promise.resolve(null),
    ]);

    // ══════════════════════════════════════════════════════════════════════
    // 2. RETRIEVE — RAG knowledge retrieval (skipped on greeting stage)
    // ══════════════════════════════════════════════════════════════════════
    const ragChunks = RAG_SKIP_STAGES.has(conversation.currentStage)
      ? []
      : await this.retrieval
          .hybridSearch(
            opts.userMessage,
            opts.tenantId,
            agentConfig.ragConfig?.topK ?? 5,
            agentConfig.ragConfig,
          )
          .catch((err) => {
            // RAG failure must not block the agent — degrade gracefully
            this.logger.error('RAG retrieval failed', err);
            return [];
          });

    // ══════════════════════════════════════════════════════════════════════
    // 3. REASON — assemble context, create session, stream first LLM call
    // ══════════════════════════════════════════════════════════════════════

    // Emit typing indicator before any LLM work
    opts.wsServer.to(opts.wsRoom).emit(ServerEvents.MESSAGE_PROCESSING);

    const ctx = this.memoryManager.buildContext({
      config: agentConfig,
      currentStage: conversation.currentStage,
      history,
      lead,
      ragChunks,
    });

    // Persist user message before LLM call (so it exists even if LLM fails)
    const userTokenCount = this.memoryManager.estimateTokens(opts.userMessage);
    await this.messages.create({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      role: MessageRole.USER,
      content: opts.userMessage,
      tokenCount: userTokenCount,
    });

    // Create the AgentSession record that tracks this full turn
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        agentId: conversation.agentId,
        stageAtStart: conversation.currentStage,
        inputMessage: opts.userMessage,
        status: AgentSessionStatus.ACTIVE,
      }),
    );

    // Update AgentState working memory for debug/resume visibility
    await this.stateRepo.update(agentState.id, {
      workingMemory: {
        systemPrompt: ctx.systemPrompt,
        contextTokens: ctx.systemTokens + ctx.historyTokens,
        retrievedChunkIds: ctx.ragChunkIds,
        leadSummary: lead ? { id: lead.id, score: lead.score, status: lead.status } : null,
      } satisfies WorkingMemory,
    });

    // Build the enabled skill set for this agent
    const enabledSkills = this.skillRegistry.getEnabled(conversation.agent?.enabledSkills ?? []);
    const tools = this.skillRegistry.toOpenAiTools(enabledSkills);

    // Build initial LLM request
    const request: LlmChatRequest = {
      model: agentConfig.llmConfig.model,
      temperature: agentConfig.llmConfig.temperature,
      max_tokens: agentConfig.llmConfig.maxTokens,
      messages: [
        { role: 'system', content: ctx.systemPrompt },
        ...ctx.messages,
      ],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    };

    const skillCtx: SkillContext = {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      agentId: conversation.agentId,
      leadId: conversation.leadId ?? undefined,
      currentStage: conversation.currentStage,

      // ── SkillServices bridge ─────────────────────────────────────────────
      // Plain-class skills call integration services through this closure.
      // Captures injected NestJS services without requiring skills to use DI.
      services: this.buildSkillServices(opts.tenantId),
    };

    // ══════════════════════════════════════════════════════════════════════
    // 4. ACT — multi-step reasoning loop (stream + tool execution)
    // ══════════════════════════════════════════════════════════════════════

    let assistantContent = '';
    let ttftMs: number | null = null;
    let iterationCount = 0;
    let currentStage = conversation.currentStage;
    let currentLeadId = conversation.leadId;
    const allExecutionRecords: ExecutionRecord[] = [];
    const messagesToPersist: CreateMessageDto[] = [];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      iterationCount = iteration + 1;

      // Stream LLM response to WebSocket room
      const { fullText, toolCalls, ttftMs: iterTtft } =
        await this.streamingProxy.streamToRoom(this.llm, request, opts.wsRoom, opts.wsServer);

      if (iteration === 0 && iterTtft !== null) ttftMs = iterTtft;

      const hasToolCalls = toolCalls.length > 0;
      const isFirstIteration = iteration === 0;

      // Queue assistant message for batch persist
      if (fullText || hasToolCalls) {
        messagesToPersist.push({
          tenantId: opts.tenantId,
          conversationId: opts.conversationId,
          role: MessageRole.ASSISTANT,
          content: fullText || null,
          toolCalls: hasToolCalls ? toolCalls : null,
          tokenCount: this.memoryManager.estimateTokens(fullText),
          sessionId: session.id,
        });
      }

      if (isFirstIteration && fullText) assistantContent = fullText;
      if (!isFirstIteration && fullText) assistantContent += '\n' + fullText;

      // Append assistant turn to rolling messages list for next iteration
      request.messages.push({
        role: 'assistant',
        content: fullText || null,
        tool_calls: hasToolCalls ? toolCalls : undefined,
      });

      if (!hasToolCalls) break; // Natural finish — no more tools to call

      // ── Announce each tool call before execution ────────────────────────
      for (const tc of toolCalls) {
        this.wsRooms.emitToolStarted(opts.conversationId, {
          toolCallId: tc.id,
          toolName: tc.function.name,
          label: this.toolLabel(tc.function.name),
        });
      }

      // ── Execute all tool calls for this iteration ───────────────────────
      const execResults = await this.skillExecutor.executeAll(toolCalls, skillCtx);

      let handoffTriggered = false;

      for (const exec of execResults) {
        allExecutionRecords.push(exec.record);

        // Emit tool finished with duration from the execution record
        this.wsRooms.emitToolFinished(opts.conversationId, {
          toolCallId: exec.toolCallId,
          toolName: exec.toolName,
          success: exec.result.success,
          durationMs: exec.record.latencyMs ?? 0,
        });

        // Apply side-effects immediately (lead update and stage transition
        // must be visible to subsequent skills in the same turn)
        const effects = exec.result.sideEffects;

        if (effects?.updateLead) {
          const updatedLead = await this.leads.upsertByConversation({
            tenantId: opts.tenantId,
            conversationId: opts.conversationId,
            visitorId: opts.visitorId,
            ...effects.updateLead as Record<string, unknown>,
          });
          currentLeadId = updatedLead.id;
          skillCtx.leadId = updatedLead.id;

          // Notify admin dashboard of new/updated lead
          this.wsRooms.emitToTenantLeads(opts.tenantId, {
            leadId: updatedLead.id,
            conversationId: opts.conversationId,
            score: updatedLead.score,
          });

          if (!conversation.leadId) {
            // First time we have a lead — also emit to visitor room
            opts.wsServer.to(opts.wsRoom).emit(ServerEvents.LEAD_CAPTURED, {
              leadId: updatedLead.id,
            });
            // Backfill leadId on the conversation in DB
            await this.conversationRepo.update(opts.conversationId, {
              leadId: updatedLead.id,
            });
            conversation.leadId = updatedLead.id;
          }

          // Holistic state snapshot so the widget can reflect lead progress
          this.wsRooms.emitStateUpdated(opts.conversationId, {
            stage: currentStage,
            leadId: currentLeadId,
            leadScore: updatedLead.score,
            leadStatus: updatedLead.status,
            iterationCount: iterationCount,
          });
        }

        if (effects?.transitionStage) {
          const freshLead = currentLeadId
            ? await this.leads.findById(currentLeadId, opts.tenantId)
            : null;

          const transition = this.stageMachine.tryTransition(
            { ...conversation, currentStage },
            effects.transitionStage as ConversationStage,
            freshLead,
          );

          if (transition.transitioned) {
            currentStage = transition.newStage;
            skillCtx.currentStage = currentStage;
            // Fine-grained stage event (existing behaviour)
            opts.wsServer.to(opts.wsRoom).emit(ServerEvents.STAGE_CHANGED, {
              stage: currentStage,
            });
            // Holistic state snapshot after stage change
            this.wsRooms.emitStateUpdated(opts.conversationId, {
              stage: currentStage,
              leadId: currentLeadId,
              iterationCount: iterationCount,
            });
          }
        }

        if (effects?.pauseAgent) {
          handoffTriggered = true;
          // Notify visitor widget — shows "connecting you to a human" message
          this.wsRooms.emitHandoffTriggered(opts.conversationId);
          // Notify admin dashboard handoff room
          this.wsRooms.emitToTenantHandoffs(opts.tenantId, {
            conversationId: opts.conversationId,
            leadId: currentLeadId,
          });
          break;
        }

        // Feed tool result back into the message list for next LLM call
        const toolResultContent = exec.result.success
          ? JSON.stringify(exec.result.data)
          : `ERROR: ${JSON.stringify(exec.result.data)}`;

        request.messages.push({
          role: 'tool',
          tool_call_id: exec.toolCallId,
          content: toolResultContent,
        });

        messagesToPersist.push({
          tenantId: opts.tenantId,
          conversationId: opts.conversationId,
          role: MessageRole.TOOL,
          content: toolResultContent,
          toolCallId: exec.toolCallId,
          toolName: exec.toolName,
          sessionId: session.id,
        });
      }

      if (handoffTriggered) break;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 5. UPDATE STATE — batch all DB writes
    // ══════════════════════════════════════════════════════════════════════
    const totalLatency = Date.now() - wallStart;
    const usage = this.llm.getLastUsage();
    const totalTokens = usage?.totalTokens ?? 0;

    // Infer stage from lead data as a safety net (in case LLM forgot to call TransitionStage)
    const freshLead = currentLeadId
      ? await this.leads.findById(currentLeadId, opts.tenantId)
      : null;
    const inferredStage = this.stageMachine.inferStageFromLead(currentStage, freshLead);
    if (inferredStage !== currentStage) {
      currentStage = inferredStage;
      opts.wsServer.to(opts.wsRoom).emit(ServerEvents.STAGE_CHANGED, { stage: currentStage });
      this.wsRooms.emitStateUpdated(opts.conversationId, {
        stage: currentStage,
        leadId: currentLeadId,
        leadScore: freshLead?.score ?? null,
        leadStatus: freshLead?.status ?? null,
        iterationCount,
      });
    }

    // Parallel DB writes
    await Promise.all([
      // Persist all queued messages in one batch
      this.messages.createMany(messagesToPersist),

      // Update conversation counters + stage
      this.conversationRepo.update(opts.conversationId, {
        currentStage,
        lastMessageAt: new Date(),
        messageCount: () => `message_count + ${messagesToPersist.length + 1}`, // +1 for user msg
        totalTokens: () => `total_tokens + ${totalTokens}`,
      }),

      // Finalise AgentSession
      this.sessionRepo.update(session.id, {
        status: AgentSessionStatus.COMPLETED,
        outputMessage: assistantContent,
        skillExecutions: allExecutionRecords as any,
        iterationCount,
        tokenUsage: usage ?? undefined,
        latencyMs: totalLatency,
        ttftMs: ttftMs ?? undefined,
        stageAtEnd: currentStage,
        completedAt: new Date(),
      }),

      // Release concurrency lock + update AgentState
      this.stateRepo.update(agentState.id, {
        currentStage,
        isProcessing: false,
        iterationCount,
        pendingToolCall: null,
        processingStartedAt: null,
      }),

      // Record LLM usage metrics
      usage
        ? this.usageTracker.record({
            tenantId: opts.tenantId,
            conversationId: opts.conversationId,
            sessionId: session.id,
            providerName: this.llm.providerName,
            modelName: agentConfig.llmConfig.model,
            operation: 'chat',
            usage,
            latencyMs: totalLatency,
            timestamp: new Date(),
          })
        : Promise.resolve(),
    ]);

    // Stage transition DB persist (outside the batch — depends on final currentStage)
    if (currentStage !== conversation.currentStage) {
      await this.stageMachine.persistTransition(opts.conversationId, currentStage);
    }

    // Emit message.complete to visitor room
    opts.wsServer.to(opts.wsRoom).emit(ServerEvents.MESSAGE_COMPLETE, {
      sessionId: session.id,
      stage: currentStage,
      content: assistantContent,
    });

    this.logger.log(
      `Turn complete — conv=${opts.conversationId} stage=${currentStage} ` +
      `iterations=${iterationCount} latency=${totalLatency}ms ttft=${ttftMs ?? 'n/a'}ms ` +
      `tokens=${totalTokens}`,
    );

    // Fire-and-forget usage tracking already done above; CRM sync if lead exists
    if (currentLeadId && freshLead?.email) {
      void this.leads.enqueueCrmSync(currentLeadId, opts.tenantId);
    }

    return {
      assistantMessage: assistantContent,
      newStage: currentStage,
      leadId: currentLeadId,
      sessionId: session.id,
      iterationCount,
    };
  }

  // ─── SkillServices bridge ────────────────────────────────────────────────

  /**
   * Build the SkillServices closure for a given tenant.
   *
   * This is the bridge between plain-class skills (no DI) and NestJS services.
   * The orchestrator creates this object once per turn and passes it via SkillContext.
   *
   * Dispatches:
   *  'crm'      → CrmIntegrationService
   *  'calendar' → CalendarIntegrationService
   *  'email'    → EmailIntegrationService
   *  'webhook'  → WebhookProvider
   */
  private buildSkillServices(tenantId: string): SkillServices {
    return {
      invokeIntegration: async <T>(
        type: 'crm' | 'calendar' | 'email' | 'webhook',
        method: string,
        args: Record<string, unknown>,
      ): Promise<T> => {
        switch (type) {
          case 'crm': {
            if (method === 'push') {
              return this.crmIntegration.push(tenantId, args as unknown as Parameters<CrmIntegrationService['push']>[1]) as Promise<T>;
            }
            throw new Error(`Unknown CRM method: ${method}`);
          }

          case 'calendar': {
            if (method === 'getBookingLink') {
              return this.calendarIntegration.getBookingLink(tenantId, args as unknown as Parameters<CalendarIntegrationService['getBookingLink']>[1]) as Promise<T>;
            }
            if (method === 'getAvailableSlots') {
              return this.calendarIntegration.getAvailableSlots(tenantId, args['date'] as string) as Promise<T>;
            }
            throw new Error(`Unknown calendar method: ${method}`);
          }

          case 'email': {
            if (method === 'send') {
              return this.emailIntegration.send(tenantId, args as unknown as Parameters<EmailIntegrationService['send']>[1]) as Promise<T>;
            }
            throw new Error(`Unknown email method: ${method}`);
          }

          case 'webhook': {
            if (method === 'deliver') {
              return this.webhookProvider.deliver(tenantId, args as unknown as Parameters<WebhookProvider['deliver']>[1]) as Promise<T>;
            }
            throw new Error(`Unknown webhook method: ${method}`);
          }

          default: {
            throw new Error(`Unknown integration type: ${type as string}`);
          }
        }
      },

      invokeTool: async <T>(toolName: string, args: Record<string, unknown>): Promise<T> => {
        const result = await this.toolExecutor.execute<T>(toolName, args, { tenantId });
        if (!result.success) {
          throw new Error(`Tool ${toolName} failed`);
        }
        return result.data;
      },
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async loadConversation(
    conversationId: string,
    tenantId: string,
  ): Promise<Conversation> {
    return this.conversationRepo.findOneOrFail({
      where: { id: conversationId, tenantId, status: ConversationStatus.ACTIVE },
      relations: ['agent', 'agent.config'],
    });
  }

  /**
   * Acquire the isProcessing lock on AgentState.
   * Uses an upsert + conditional update to be safe under concurrent invocations.
   *
   * Returns the AgentState entity if the lock was acquired, null if already locked.
   */
  private async acquireLock(
    conversation: Conversation,
    tenantId: string,
  ): Promise<AgentState | null> {
    // Upsert the state row (one per conversation)
    await this.stateRepo
      .createQueryBuilder()
      .insert()
      .into(AgentState)
      .values({
        tenantId,
        conversationId: conversation.id,
        agentId: conversation.agentId,
        currentStage: conversation.currentStage,
        isProcessing: false,
        iterationCount: 0,
      })
      .orIgnore() // skip if row already exists
      .execute();

    // Conditional update: only set isProcessing=true if it's currently false
    const result = await this.stateRepo
      .createQueryBuilder()
      .update(AgentState)
      .set({ isProcessing: true, processingStartedAt: new Date() })
      .where('conversation_id = :cid', { cid: conversation.id })
      .andWhere('tenant_id = :tid', { tid: tenantId })
      .andWhere('is_processing = false')
      .execute();

    if (result.affected === 0) return null; // another instance holds the lock

    return this.stateRepo.findOneOrFail({
      where: { conversationId: conversation.id, tenantId },
    });
  }

  /**
   * Maps a skill name to a human-readable label for the widget progress indicator.
   * Falls back to the skill name itself if not listed.
   */
  private toolLabel(skillName: string): string {
    const labels: Record<string, string> = {
      AnswerQuestion: 'Searching knowledge base…',
      QualifyLead: 'Analysing your needs…',
      CaptureContact: 'Saving your details…',
      RecommendService: 'Finding the best match…',
      ScheduleDemo: 'Checking calendar availability…',
      PushToCRM: 'Syncing to CRM…',
      SendFollowUpEmail: 'Scheduling follow-up…',
      HandoffToHuman: 'Connecting you to a human…',
      TransitionStage: 'Updating conversation stage…',
    };
    return labels[skillName] ?? `Running ${skillName}…`;
  }

  /**
   * Release the lock unconditionally — called on both success and error paths.
   */
  private async releaseLock(agentState: AgentState): Promise<void> {
    await this.stateRepo.update(agentState.id, {
      isProcessing: false,
      processingStartedAt: null,
    });
  }

  /**
   * Error recovery — mark session as FAILED and release lock.
   * Called from the gateway/worker try-catch wrapping run().
   */
  async handleRunError(
    conversationId: string,
    tenantId: string,
    sessionId: string,
    error: Error,
  ): Promise<void> {
    this.logger.error(`Agent run failed for conv ${conversationId}`, error.stack);

    await Promise.allSettled([
      this.sessionRepo.update(sessionId, {
        status: AgentSessionStatus.FAILED,
        errorMessage: error.message,
        completedAt: new Date(),
      }),
      this.stateRepo.update(
        { conversationId, tenantId },
        { isProcessing: false, processingStartedAt: null },
      ),
    ]);
  }
}
