import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { TenantIntegration } from '../tenants/entities/tenant-integration.entity';

// Services
import { IntegrationConfigService } from './services/integration-config.service';
import { AdminIntegrationService } from './services/admin-integration.service';
import { CrmIntegrationService } from './services/crm-integration.service';
import { CalendarIntegrationService } from './services/calendar-integration.service';
import { EmailIntegrationService } from './services/email-integration.service';

// CRM adapters
import { HubspotClient } from './crm/hubspot/hubspot.client';
import { SalesforceClient } from './crm/salesforce/salesforce.client';
import { MockCrmClient } from './crm/mock/mock-crm.client';

// Calendar adapters
import { CalendlyClient } from './calendar/calendly/calendly.client';
import { CalcomClient } from './calendar/calcom/calcom.client';
import { MockCalendarClient } from './calendar/mock/mock-calendar.client';

// Email adapter
import { SmtpClient } from './email/smtp/smtp.client';

// Webhook
import { WebhookProvider } from './webhooks/webhook.provider';

// Notifications worker
import { NotificationsWorker } from './workers/notifications.worker';
import { WorkflowJob } from '../workflows/entities/workflow-job.entity';

// Common + admin controller
import { CommonModule } from '../common/common.module';
import { IntegrationsController } from './controllers/integrations.controller';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * IntegrationsModule
 *
 * Third-party integration adapters behind façade services.
 *
 * Admin API (tenant-facing):
 *   GET    /integrations            — list integration statuses (no credentials)
 *   GET    /integrations/:type      — single integration detail
 *   PUT    /integrations/:type      — upsert credentials + config (encrypted at rest)
 *   DELETE /integrations/:type      — disconnect
 *   POST   /integrations/:type/test — test connection
 *
 * Internal façades (used by AgentOrchestratorService via SkillServices bridge):
 *   CrmIntegrationService, CalendarIntegrationService,
 *   EmailIntegrationService, WebhookProvider
 *
 * Workers:
 *   NotificationsWorker — @Processor('notifications') — reliable webhook delivery
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantIntegration, WorkflowJob]),
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }),
    CommonModule, // provides EncryptionService
  ],
  controllers: [IntegrationsController],
  providers: [
    // Admin write path
    AdminIntegrationService,

    // Runtime read/execute path
    IntegrationConfigService,

    // CRM
    HubspotClient,
    SalesforceClient,
    MockCrmClient,
    CrmIntegrationService,

    // Calendar
    CalendlyClient,
    CalcomClient,
    MockCalendarClient,
    CalendarIntegrationService,

    // Email
    SmtpClient,
    EmailIntegrationService,

    // Webhook + async delivery worker
    WebhookProvider,
    NotificationsWorker,
  ],
  exports: [
    IntegrationConfigService,
    CrmIntegrationService,
    CalendarIntegrationService,
    EmailIntegrationService,
    WebhookProvider,
  ],
})
export class IntegrationsModule {}
