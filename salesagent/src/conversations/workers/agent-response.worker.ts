import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AgentOrchestratorService } from '../../agents/services/agent-orchestrator.service';
import { AgentResponseJob, QUEUE_NAMES } from '../../common/types/queue-jobs.types';
import { ConversationsService } from '../services/conversations.service';
import { MessagesService } from '../services/messages.service';
import { WsRoomsService } from '../../websocket/services/ws-rooms.service';
import { ServerEvents } from '../../websocket/interfaces/ws-events.enum';
import { Server } from 'socket.io';

/**
 * AgentResponseWorker
 *
 * BullMQ async fallback for when the WebSocket connection drops mid-conversation.
 * Invokes the same AgentOrchestratorService.run() pipeline but without live streaming.
 * The completed response is persisted and delivered when the visitor reconnects.
 *
 * Retry policy (configured by the producer in ConversationsGateway):
 *  - 2 attempts total
 *  - Exponential backoff: 5s, 10s
 *
 * Note: Since there is no live WS connection, the orchestrator receives a no-op
 * server facade. Tokens are not streamed but the full response is persisted.
 * On visitor reconnect, MessagesService.getHistory() returns the complete thread.
 */
@Processor(QUEUE_NAMES.AGENT_RESPONSE, { concurrency: 5 })
export class AgentResponseWorker extends WorkerHost {
  private readonly logger = new Logger(AgentResponseWorker.name);

  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly wsRooms: WsRoomsService,
  ) {
    super();
  }

  async process(job: Job<AgentResponseJob>): Promise<void> {
    const { conversationId, tenantId, messageId } = job.data;

    this.logger.log(
      `Processing async agent response: conversationId=${conversationId} messageId=${messageId} attempt=${job.attemptsMade + 1}`,
    );

    // Load conversation to get visitorId
    const conversation = await this.conversations.findById(conversationId, tenantId);

    // Load the user message that triggered this job
    const history = await this.messages.getHistory(conversationId, tenantId);
    const userMessage = history.find((m) => m.id === messageId);

    if (!userMessage || !userMessage.content) {
      this.logger.warn(
        `AgentResponseWorker: user message ${messageId} not found or has no content — skipping`,
      );
      return;
    }

    // Build a no-op server facade so the orchestrator can call server.to().emit()
    // without errors. Tokens won't be streamed but the pipeline completes normally.
    const noopServer = this.buildNoopServer();

    try {
      const result = await this.orchestrator.run({
        conversationId,
        tenantId,
        visitorId: conversation.visitorId,
        userMessage: userMessage.content,
        wsServer: noopServer,
        wsRoom: `conversation:${conversationId}`,
      });

      this.logger.log(
        `Async agent response complete: conversationId=${conversationId} stage=${result.newStage}`,
      );

      // Notify any re-connected visitors in the conversation room
      this.wsRooms.emitToConversation(conversationId, ServerEvents.MESSAGE_COMPLETE, {
        conversationId,
        stage: result.newStage,
        leadId: result.leadId,
        sessionId: result.sessionId,
        async: true,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Async agent response failed: conversationId=${conversationId} ` +
          (err instanceof Error ? err.message : String(err)),
      );
      throw err; // BullMQ will retry
    }
  }

  // ─── Worker events ────────────────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job<AgentResponseJob>): void {
    this.logger.log(
      `Job completed: id=${job.id} conversationId=${job.data.conversationId} ` +
        `latency=${Date.now() - job.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AgentResponseJob> | undefined, err: Error): void {
    this.logger.error(
      `Job failed: id=${job?.id} conversationId=${job?.data.conversationId} ` +
        `attempts=${job?.attemptsMade}: ${err.message}`,
    );
  }

  // ─── No-op Server facade ──────────────────────────────────────────────────

  /**
   * Builds a minimal Server-compatible object whose to().emit() methods are no-ops.
   * Prevents the orchestrator's StreamingProxyService from crashing when there
   * is no live WebSocket connection.
   */
  private buildNoopServer(): Server {
    const noop = { emit: () => false };
    return { to: () => noop, in: () => noop } as unknown as Server;
  }
}
