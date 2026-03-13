import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

import { Agent } from './entities/agent.entity';
import { AgentConfig } from './entities/agent-config.entity';
import { AgentSession } from './entities/agent-session.entity';
import { AgentState } from './entities/agent-state.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationMessage } from '../conversations/entities/conversation-message.entity';
import { Lead } from '../leads/entities/lead.entity';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { Meeting } from '../leads/entities/meeting.entity';

import { AgentsController } from './controllers/agents.controller';
import { AgentsService } from './services/agents.service';
import { AgentOrchestratorService } from './services/agent-orchestrator.service';
import { StageStateMachineService } from './services/stage-state-machine.service';
import { MemoryManagerService } from './services/memory-manager.service';
import { StreamingProxyService } from './services/streaming-proxy.service';
import { PromptBuilderService } from './prompts/prompt-builder.service';

import { SkillsModule } from '../skills/skills.module';
import { RagModule } from '../rag/rag.module';
import { LlmModule } from '../llm/llm.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ToolsModule } from '../tools/tools.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { MessagesService } from '../conversations/services/messages.service';
import { LeadsService } from '../leads/services/leads.service';

/**
 * AgentsModule
 *
 * Agent configuration CRUD and the central reasoning loop.
 *
 * Admin API:
 *   GET    /agents                         — list agents
 *   POST   /agents                         — create agent + config
 *   GET    /agents/:id                     — agent detail with config
 *   PATCH  /agents/:id                     — update persona, skills, llmConfig
 *   DELETE /agents/:id                     — soft-delete
 *   POST   /agents/:id/deploy              — status → ACTIVE
 *   PUT    /agents/:id/skills              — replace enabledSkills list
 *   POST   /agents/:id/skills/:skillName   — enable a skill
 *   DELETE /agents/:id/skills/:skillName   — disable a skill
 *
 * Internal (no HTTP):
 *   AgentOrchestratorService  — the full OBSERVE→RETRIEVE→REASON→ACT→UPDATE loop
 *   AgentsService             — exported for WS guards and other modules
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Agent,
      AgentConfig,
      AgentSession,
      AgentState,
      Conversation,
      ConversationMessage,
      Lead,
      LeadActivity,
      Meeting,
    ]),
    BullModule.registerQueue({ name: QUEUE_NAMES.CRM_SYNC }),
    LlmModule,
    SkillsModule,
    RagModule,
    IntegrationsModule,
    ToolsModule,
    WebsocketModule,
  ],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    AgentOrchestratorService,
    StageStateMachineService,
    MemoryManagerService,
    PromptBuilderService,
    StreamingProxyService,
    MessagesService,
    LeadsService,
  ],
  exports: [
    AgentOrchestratorService,
    AgentsService,
    StageStateMachineService,
  ],
})
export class AgentsModule {}
