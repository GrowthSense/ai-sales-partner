import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WhatsAppWebhookController } from './controllers/whatsapp-webhook.controller';
import { WhatsAppService } from './services/whatsapp.service';
import { WhatsAppClientService } from './services/whatsapp-client.service';

import { TenantIntegration } from '../tenants/entities/tenant-integration.entity';
import { AgentsModule } from '../agents/agents.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * WhatsAppModule
 *
 * Handles WhatsApp Business Cloud API integration.
 *
 * Webhook endpoints (public, no JWT auth):
 *   GET  /whatsapp/webhook  — Meta verification challenge
 *   POST /whatsapp/webhook  — Incoming messages → AI agent → reply
 *
 * The WhatsApp channel plugs into the same AgentOrchestratorService used by
 * the web chat widget, so tenants get identical AI behaviour on both channels.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantIntegration]),
    AgentsModule,
    ConversationsModule,
    IntegrationsModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppService, WhatsAppClientService],
})
export class WhatsAppModule {}
