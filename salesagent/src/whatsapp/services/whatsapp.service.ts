import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server } from 'socket.io';
import { createHash } from 'crypto';

import { WhatsAppClientService } from './whatsapp-client.service';
import { IntegrationConfigService } from '../../integrations/services/integration-config.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { AgentOrchestratorService } from '../../agents/services/agent-orchestrator.service';
import { AgentsService } from '../../agents/services/agents.service';

import { TenantIntegration } from '../../tenants/entities/tenant-integration.entity';
import { IntegrationType, IntegrationStatus, AgentStatus } from '../../common/enums';

export interface IncomingWhatsAppMessage {
  from: string;          // sender phone number e.g. "263771234567"
  messageId: string;     // WhatsApp message ID
  text: string;          // message body
  phoneNumberId: string; // our business phone number ID
  timestamp: number;
}

/**
 * WhatsAppService — handles incoming WhatsApp messages end-to-end.
 *
 * Flow:
 *   1. Identify tenant by phoneNumberId stored in integration config
 *   2. Derive a stable visitorId from the sender's phone (hashed)
 *   3. Find or create an ACTIVE conversation for this visitor
 *   4. Run the agent orchestrator (same as web chat)
 *   5. Send the AI response back via WhatsApp Business Cloud API
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  // Cache: phoneNumberId → { tenantId, agentId, accessToken }
  private readonly tenantCache = new Map<string, {
    tenantId: string;
    agentId: string;
    accessToken: string;
    phoneNumberId: string;
  }>();

  constructor(
    @InjectRepository(TenantIntegration)
    private readonly integrationRepo: Repository<TenantIntegration>,

    private readonly whatsappClient: WhatsAppClientService,
    private readonly integrationConfig: IntegrationConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly agentOrchestrator: AgentOrchestratorService,
    private readonly agentsService: AgentsService,
  ) {}

  // ─── Webhook verification ──────────────────────────────────────────────────

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    // Token is validated per-tenant at connection time.
    // For a single-tenant setup, we can verify against any stored verify_token.
    if (mode === 'subscribe') {
      this.logger.log(`WhatsApp webhook verified`);
      return challenge;
    }
    return null;
  }

  async verifyWebhookForTenant(
    mode: string,
    token: string,
    challenge: string,
    phoneNumberId: string,
  ): Promise<string | null> {
    if (mode !== 'subscribe') return null;

    // Find integration by phoneNumberId config field
    const integration = await this.integrationRepo
      .createQueryBuilder('ti')
      .where("ti.type = :type", { type: IntegrationType.WHATSAPP_BUSINESS })
      .andWhere("ti.status = :status", { status: IntegrationStatus.CONNECTED })
      .andWhere("ti.config->>'phoneNumberId' = :phoneNumberId", { phoneNumberId })
      .getOne();

    if (!integration) return null;

    // Load credentials to get verify_token
    const { credentials } = await this.integrationConfig.getConfigAndCredentials(
      integration.tenantId,
      IntegrationType.WHATSAPP_BUSINESS,
    );

    const verifyToken = (credentials as any).verifyToken;
    if (verifyToken && token === verifyToken) return challenge;
    if (!verifyToken) return challenge; // No verify token set — accept all (dev mode)
    return null;
  }

  // ─── Message processing ────────────────────────────────────────────────────

  async handleIncomingMessage(msg: IncomingWhatsAppMessage): Promise<void> {
    try {
      const tenant = await this.resolveTenant(msg.phoneNumberId);
      if (!tenant) {
        this.logger.warn(`No tenant found for WhatsApp phoneNumberId: ${msg.phoneNumberId}`);
        return;
      }

      // Mark message as read (shows blue ticks)
      await this.whatsappClient.markRead(msg.phoneNumberId, tenant.accessToken, msg.messageId);

      // Derive stable visitorId from phone number (hashed for privacy)
      const visitorId = this.phoneToVisitorId(msg.from);

      // Find active conversation or create new one
      const conversation = await this.findOrCreateConversation(
        tenant.tenantId,
        tenant.agentId,
        visitorId,
      );

      // Run the agent orchestrator (same engine as web chat)
      // Use a no-op WebSocket server — WhatsApp doesn't need streaming
      const mockWsServer = {
        to: () => ({ emit: () => {} }),
      } as unknown as Server;

      const result = await this.agentOrchestrator.run({
        conversationId: conversation.id,
        tenantId: tenant.tenantId,
        visitorId,
        userMessage: msg.text,
        wsServer: mockWsServer,
        wsRoom: `conversation:${conversation.id}`,
      });

      // Send the AI response back via WhatsApp
      if (result.assistantMessage) {
        await this.whatsappClient.sendText(
          msg.phoneNumberId,
          tenant.accessToken,
          msg.from,
          result.assistantMessage,
        );
      }

      this.logger.log(
        `WhatsApp conversation handled: tenant=${tenant.tenantId} visitor=${msg.from} stage=${result.newStage}`,
      );
    } catch (err) {
      this.logger.error(`WhatsApp message processing failed: ${(err as Error).message}`);
      // Don't throw — webhook must return 200 to Meta or it will retry endlessly
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async resolveTenant(phoneNumberId: string): Promise<{
    tenantId: string;
    agentId: string;
    accessToken: string;
    phoneNumberId: string;
  } | null> {
    // Check cache first
    if (this.tenantCache.has(phoneNumberId)) {
      return this.tenantCache.get(phoneNumberId)!;
    }

    // Find TenantIntegration by phoneNumberId stored in config JSONB
    const integration = await this.integrationRepo
      .createQueryBuilder('ti')
      .addSelect('ti.credentials')
      .where("ti.type = :type", { type: IntegrationType.WHATSAPP_BUSINESS })
      .andWhere("ti.status = :status", { status: IntegrationStatus.CONNECTED })
      .andWhere("ti.config->>'phoneNumberId' = :phoneNumberId", { phoneNumberId })
      .getOne();

    if (!integration) return null;

    // Decrypt credentials
    const { credentials } = await this.integrationConfig.getConfigAndCredentials(
      integration.tenantId,
      IntegrationType.WHATSAPP_BUSINESS,
    );

    const accessToken = (credentials as any).accessToken as string;
    if (!accessToken) return null;

    // Find the tenant's primary active agent
    const agents = await this.agentsService.findByTenant(integration.tenantId);
    const activeAgent = agents.find((a) => a.status === AgentStatus.ACTIVE) ?? agents[0];
    if (!activeAgent) {
      this.logger.warn(`Tenant ${integration.tenantId} has no agents — WhatsApp message ignored`);
      return null;
    }

    const result = {
      tenantId: integration.tenantId,
      agentId: activeAgent.id,
      accessToken,
      phoneNumberId,
    };

    // Cache for 5 minutes
    this.tenantCache.set(phoneNumberId, result);
    setTimeout(() => this.tenantCache.delete(phoneNumberId), 5 * 60 * 1000);

    return result;
  }

  private async findOrCreateConversation(
    tenantId: string,
    agentId: string,
    visitorId: string,
  ) {
    // Find an active conversation for this WhatsApp visitor
    const [existing] = await this.conversationsService.findAll(
      tenantId,
      { visitorId, status: 'active' as any },
      { page: 1, limit: 1 },
    );

    if (existing.length > 0) return existing[0];

    // Create a new conversation
    return this.conversationsService.create({
      tenantId,
      agentId,
      visitorId,
      metadata: {
        pageUrl: 'whatsapp',
        pageTitle: 'WhatsApp',
        referrer: null,
        utmSource: 'whatsapp',
        utmMedium: 'messaging',
        utmCampaign: null,
        deviceType: 'mobile',
        userAgent: 'WhatsApp',
        ipAddress: null,
        countryCode: 'ZW',
      },
    });
  }

  private phoneToVisitorId(phone: string): string {
    // Stable UUID-like ID from phone number (no reverse-engineering risk)
    const hash = createHash('sha256').update(`whatsapp:${phone}`).digest('hex');
    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16),
      ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
      hash.slice(20, 32),
    ].join('-');
  }
}
