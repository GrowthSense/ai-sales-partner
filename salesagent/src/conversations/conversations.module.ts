import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Conversation } from './entities/conversation.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { AgentState } from '../agents/entities/agent-state.entity';
import { Lead } from '../leads/entities/lead.entity';

import { ConversationsService } from './services/conversations.service';
import { MessagesService } from './services/messages.service';
import { ConversationsController } from './controllers/conversations.controller';
import { AgentResponseWorker } from './workers/agent-response.worker';
import { ConversationsGateway } from '../websocket/gateways/conversations.gateway';

import { AgentsModule } from '../agents/agents.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * ConversationsModule
 *
 * Owns conversation and message lifecycle, the visitor chat WebSocket gateway,
 * and the async agent-response fallback BullMQ worker.
 *
 * Dependency graph (no circular dependencies):
 *   ConversationsModule → AgentsModule (AgentOrchestratorService)
 *   ConversationsModule → WebsocketModule (WsRoomsService, WsWidgetGuard, WsJwtGuard)
 *   AgentsModule        → (does NOT import ConversationsModule)
 *   WebsocketModule     → (does NOT import ConversationsModule)
 *
 * HTTP (admin read API):
 *   GET    /conversations               — list with filters
 *   GET    /conversations/:id           — conversation detail
 *   GET    /conversations/:id/messages  — message history
 *   PATCH  /conversations/:id           — admin update
 *   GET    /conversations/:id/session-state — live agent state (debug)
 *   GET    /conversations/:id/lead      — lead summary
 *
 * WebSocket (/chat namespace):
 *   IN:   conversation.start | message.send | conversation.end
 *   OUT:  message.processing | message.chunk | message.complete
 *         stage.changed | lead.captured | error
 *
 * BullMQ (agent-response queue):
 *   AgentResponseWorker — async fallback when WS drops mid-turn
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationMessage, AgentState, Lead]),

    BullModule.registerQueue({ name: QUEUE_NAMES.AGENT_RESPONSE }),

    // AgentOrchestratorService for the gateway and worker
    AgentsModule,

    // WsRoomsService, WsWidgetGuard, WsJwtGuard for the gateway
    WebsocketModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    MessagesService,
    ConversationsGateway,
    AgentResponseWorker,
  ],
  exports: [ConversationsService, MessagesService],
})
export class ConversationsModule {}
