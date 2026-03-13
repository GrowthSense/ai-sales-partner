import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { WsWidgetGuard } from '../guards/ws-widget.guard';
import { WsRoomsService } from '../services/ws-rooms.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { MessagesService } from '../../conversations/services/messages.service';
import { AgentOrchestratorService } from '../../agents/services/agent-orchestrator.service';
import { AgentsService } from '../../agents/services/agents.service';

import { VisitorClientData } from '../interfaces/ws-client-data.interface';
import { ClientEvents, ServerEvents } from '../interfaces/ws-events.enum';
import { MessageRole } from '../../common/enums';

interface ConversationStartPayload {
  agentId?: string;
  widgetKey?: string;
  metadata?: {
    pageUrl?: string;
    pageTitle?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    deviceType?: 'desktop' | 'mobile' | 'tablet';
  };
}

interface MessageSendPayload {
  conversationId: string;
  content: string;
}

interface ConversationEndPayload {
  conversationId: string;
}

/**
 * ConversationsGateway
 *
 * Socket.io gateway for the /chat namespace.
 * Handles real-time visitor chat: conversation lifecycle and message flow.
 *
 * Authentication: WsWidgetGuard validates the widget visitor JWT on every
 * event. The JWT is issued by POST /auth/widget/session.
 *
 * Room model:
 *   'visitor:<visitorId>'         — visitor's personal room
 *   'conversation:<id>'           — conversation room (streaming target)
 *
 * Flow for message.send:
 *   1. Persist user message
 *   2. Emit message.processing (typing indicator)
 *   3. Run AgentOrchestratorService (streams tokens via message.chunk events)
 *   4. Emit message.complete with final result
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ConversationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ConversationsGateway.name);

  constructor(
    private readonly rooms: WsRoomsService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly agents: AgentsService,
  ) {}

  afterInit(server: Server): void {
    this.rooms.setChatServer(server);
    this.logger.log('Chat gateway initialised');
  }

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  @UseGuards(WsWidgetGuard)
  handleConnection(client: Socket): void {
    const data = client.data as VisitorClientData;
    client.join(`visitor:${data.visitorId}`);
    this.logger.debug(
      `Visitor connected: visitorId=${data.visitorId} tenantId=${data.tenantId} socketId=${client.id}`,
    );
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<VisitorClientData>;
    this.logger.debug(
      `Visitor disconnected: visitorId=${data.visitorId ?? 'unknown'} socketId=${client.id}`,
    );
    // Conversation end-on-disconnect is handled by inactivity timeout in the orchestrator.
    // Explicit conversation.end is preferred when the widget is closed gracefully.
  }

  // ─── conversation.start ───────────────────────────────────────────────────

  @UseGuards(WsWidgetGuard)
  @SubscribeMessage(ClientEvents.CONVERSATION_START)
  async handleConversationStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationStartPayload,
  ): Promise<{ conversationId: string; stage: string }> {
    const { visitorId, tenantId } = client.data as VisitorClientData;

    // Resolve agentId — accept explicit agentId or auto-select first active agent for tenant
    let agentId = payload.agentId;
    if (!agentId) {
      const tenantAgents = await this.agents.findByTenant(tenantId);
      const active = tenantAgents.find((a) => a.status === 'active') ?? tenantAgents[0];
      if (!active) throw new WsException('No agent configured for this tenant');
      agentId = active.id;
    }

    const conversation = await this.conversations.create({
      tenantId,
      agentId,
      visitorId,
      metadata: payload.metadata,
    });

    // Join the conversation room so streaming tokens reach this client
    await client.join(`conversation:${conversation.id}`);
    (client.data as VisitorClientData).conversationId = conversation.id;

    this.logger.log(
      `Conversation started: id=${conversation.id} agentId=${payload.agentId} tenantId=${tenantId}`,
    );

    return { conversationId: conversation.id, stage: conversation.currentStage };
  }

  // ─── message.send ─────────────────────────────────────────────────────────

  @UseGuards(WsWidgetGuard)
  @SubscribeMessage(ClientEvents.MESSAGE_SEND)
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageSendPayload,
  ): Promise<void> {
    const { visitorId, tenantId } = client.data as VisitorClientData;

    if (!payload.conversationId || !payload.content?.trim()) {
      throw new WsException('conversationId and content are required');
    }

    if (payload.content.length > 4000) {
      throw new WsException('Message content exceeds 4000 character limit');
    }

    // Verify conversation belongs to this visitor+tenant
    const conversation = await this.conversations.findById(payload.conversationId, tenantId);

    if (conversation.visitorId !== visitorId) {
      throw new WsException('Forbidden: conversation does not belong to this visitor');
    }

    const room = `conversation:${payload.conversationId}`;

    // Persist user message
    const userMessage = await this.messages.create({
      tenantId,
      conversationId: payload.conversationId,
      role: MessageRole.USER,
      content: payload.content,
    });

    // Signal typing indicator to the conversation room
    this.server.to(room).emit(ServerEvents.MESSAGE_PROCESSING, {
      conversationId: payload.conversationId,
    });

    // Run the agent reasoning loop (streams tokens via WS, then completes)
    try {
      const result = await this.orchestrator.run({
        conversationId: payload.conversationId,
        tenantId,
        visitorId,
        userMessage: payload.content,
        wsServer: this.server,
        wsRoom: room,
      });

      this.server.to(room).emit(ServerEvents.MESSAGE_COMPLETE, {
        conversationId: payload.conversationId,
        stage: result.newStage,
        leadId: result.leadId,
        sessionId: result.sessionId,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Orchestrator error for conversation ${payload.conversationId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      this.server.to(room).emit(ServerEvents.ERROR, {
        conversationId: payload.conversationId,
        message: 'An error occurred processing your message. Please try again.',
      });
    }
  }

  // ─── conversation.end ─────────────────────────────────────────────────────

  @UseGuards(WsWidgetGuard)
  @SubscribeMessage(ClientEvents.CONVERSATION_END)
  async handleConversationEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ConversationEndPayload,
  ): Promise<void> {
    const { tenantId, visitorId } = client.data as VisitorClientData;

    if (!payload.conversationId) {
      throw new WsException('conversationId is required');
    }

    const conversation = await this.conversations.findById(payload.conversationId, tenantId);

    if (conversation.visitorId !== visitorId) {
      throw new WsException('Forbidden');
    }

    await this.conversations.end(payload.conversationId, tenantId);

    client.leave(`conversation:${payload.conversationId}`);
    (client.data as VisitorClientData).conversationId = undefined;

    this.logger.log(
      `Conversation ended: id=${payload.conversationId} tenantId=${tenantId}`,
    );
  }
}
