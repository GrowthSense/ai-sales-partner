import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { AdminIntegrationService } from '../services/admin-integration.service';
import { TenantIntegration } from '../../tenants/entities/tenant-integration.entity';
import { UpsertIntegrationDto } from '../dtos/upsert-integration.dto';
import { IntegrationType } from '../../common/enums';

/**
 * IntegrationsController
 *
 * Admin API for managing third-party integration credentials per tenant.
 * All credential writes are encrypted before persistence.
 *
 * Endpoints:
 *   GET    /integrations                    — list all integration statuses
 *   GET    /integrations/:type              — get single integration details
 *   PUT    /integrations/:type              — upsert credentials + config
 *   DELETE /integrations/:type              — disconnect integration
 *   POST   /integrations/:type/test         — test connection
 *
 * Supported types: crm_hubspot | crm_salesforce | calendar_calendly |
 *                  calendar_calcom | email_smtp | webhook
 */
@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly adminIntegrations: AdminIntegrationService) {}

  @Get()
  async list(@TenantId() tenantId: string): Promise<TenantIntegration[]> {
    return this.adminIntegrations.list(tenantId);
  }

  @Get(':type')
  async findOne(
    @TenantId() tenantId: string,
    @Param('type') type: string,
  ): Promise<TenantIntegration> {
    return this.adminIntegrations.findOne(tenantId, type as IntegrationType);
  }

  /**
   * PUT /integrations/:type
   *
   * Create or update an integration's credentials and config.
   * Credentials are encrypted at rest — never stored as plaintext.
   *
   * Body: { type, credentials: {...}, config?: {...} }
   *
   * Examples:
   *   HubSpot:   { type: 'crm_hubspot', credentials: { accessToken: 'pat-...' } }
   *   SMTP:      { type: 'email_smtp', credentials: { host, port, user, password, secure } }
   *   Calendly:  { type: 'calendar_calendly', credentials: { apiKey: '...' }, config: { eventTypeUri: '...' } }
   *   Webhook:   { type: 'webhook', credentials: { signingSecret: '...' }, config: { url, events: [] } }
   */
  @Put(':type')
  async upsert(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Body() dto: UpsertIntegrationDto,
  ): Promise<TenantIntegration> {
    return this.adminIntegrations.upsert(
      tenantId,
      type as IntegrationType,
      dto.credentials,
      dto.config,
    );
  }

  @Delete(':type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param('type') type: string,
  ): Promise<void> {
    await this.adminIntegrations.delete(tenantId, type as IntegrationType);
  }

  /**
   * POST /integrations/:type/test
   *
   * Tests the stored credentials by making a lightweight API call.
   * Returns { ok: boolean, message: string }.
   * Also updates the integration status in DB (CONNECTED or ERROR).
   */
  @Post(':type/test')
  async test(
    @TenantId() tenantId: string,
    @Param('type') type: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.adminIntegrations.test(tenantId, type as IntegrationType);
  }
}
