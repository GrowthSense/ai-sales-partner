import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantIntegration } from '../../tenants/entities/tenant-integration.entity';
import { IntegrationType, IntegrationStatus } from '../../common/enums';
import { IntegrationConfigService } from './integration-config.service';
import { CrmIntegrationService } from './crm-integration.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { EmailIntegrationService } from './email-integration.service';
import { GoogleMeetClient } from '../calendar/google-meet/google-meet.client';
import { MicrosoftTeamsClient } from '../calendar/microsoft-teams/microsoft-teams.client';

/**
 * AdminIntegrationService
 *
 * Admin-facing CRUD for TenantIntegration records.
 * Handles credential encryption before persistence and decryption
 * for connection tests.
 *
 * Separate from IntegrationConfigService (which is runtime/read-only for skills)
 * to keep the admin write-path isolated from the hot skill execution path.
 */
@Injectable()
export class AdminIntegrationService {
  private readonly logger = new Logger(AdminIntegrationService.name);

  constructor(
    @InjectRepository(TenantIntegration)
    private readonly integrationRepo: Repository<TenantIntegration>,

    private readonly configService: IntegrationConfigService,
    private readonly crmService: CrmIntegrationService,
    private readonly calendarService: CalendarIntegrationService,
    private readonly emailService: EmailIntegrationService,
    private readonly googleMeet: GoogleMeetClient,
    private readonly microsoftTeams: MicrosoftTeamsClient,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  /**
   * Returns all integration records for the tenant.
   * Credentials are NOT included (select: false at entity level).
   */
  async list(tenantId: string): Promise<TenantIntegration[]> {
    return this.integrationRepo.find({
      where: { tenantId },
      order: { type: 'ASC' },
    });
  }

  async findOne(tenantId: string, type: IntegrationType): Promise<TenantIntegration> {
    const record = await this.integrationRepo.findOne({ where: { tenantId, type } });
    if (!record) throw new NotFoundException(`Integration ${type} not configured`);
    return record;
  }

  // ─── Upsert ───────────────────────────────────────────────────────────────

  /**
   * Create or update an integration.
   * Encrypts credentials before saving. Sets status to CONNECTED.
   */
  async upsert(
    tenantId: string,
    type: IntegrationType,
    credentials: Record<string, unknown>,
    config: Record<string, unknown> = {},
  ): Promise<TenantIntegration> {
    let record = await this.integrationRepo.findOne({ where: { tenantId, type } });

    const encryptedCredentials = this.configService.encryptCredentials(credentials);

    if (!record) {
      record = this.integrationRepo.create({
        tenantId,
        type,
        status: IntegrationStatus.CONNECTED,
        credentials: encryptedCredentials,
        config,
        connectedAt: new Date(),
        lastUsedAt: new Date(),
      });
    } else {
      record.credentials = encryptedCredentials;
      record.config = { ...record.config, ...config };
      record.status = IntegrationStatus.CONNECTED;
      record.errorMessage = null;
      record.connectedAt = record.connectedAt ?? new Date();
      record.lastUsedAt = new Date();
    }

    const saved = await this.integrationRepo.save(record);
    this.logger.log(`Integration upserted: tenantId=${tenantId} type=${type}`);
    return saved;
  }

  // ─── Delete (disconnect) ──────────────────────────────────────────────────

  async delete(tenantId: string, type: IntegrationType): Promise<void> {
    const record = await this.findOne(tenantId, type);
    await this.integrationRepo.remove(record);
    this.logger.log(`Integration disconnected: tenantId=${tenantId} type=${type}`);
  }

  // ─── Test connection ──────────────────────────────────────────────────────

  /**
   * Test an existing integration by making a lightweight API call.
   * Updates status to CONNECTED or ERROR based on the result.
   */
  async test(tenantId: string, type: IntegrationType): Promise<{ ok: boolean; message: string }> {
    try {
      let ok = false;

      switch (type) {
        case IntegrationType.CRM_HUBSPOT:
        case IntegrationType.CRM_SALESFORCE: {
          ok = await this.configService.isConnected(tenantId, type);
          break;
        }
        case IntegrationType.CALENDAR_CALENDLY:
        case IntegrationType.CALENDAR_CALCOM: {
          ok = await this.configService.isConnected(tenantId, type);
          break;
        }
        case IntegrationType.CALENDAR_GOOGLE_MEET: {
          const { credentials } = await this.configService.getConfigAndCredentials(tenantId, type);
          ok = await this.googleMeet.testConnection({
            provider: 'google_meet',
            apiKey: credentials.refreshToken as string,
            clientId: credentials.clientId as string,
            clientSecret: credentials.clientSecret as string,
            refreshToken: credentials.refreshToken as string,
          });
          break;
        }
        case IntegrationType.CALENDAR_MICROSOFT_TEAMS: {
          const { record, credentials } = await this.configService.getConfigAndCredentials(tenantId, type);
          ok = await this.microsoftTeams.testConnection({
            provider: 'microsoft_teams',
            apiKey: credentials.clientSecret as string,
            clientId: credentials.clientId as string,
            tenantId: credentials.tenantId as string,
            organizerEmail: record.config['organizerEmail'] as string | undefined,
          });
          break;
        }
        case IntegrationType.EMAIL_SMTP: {
          ok = await this.configService.isConnected(tenantId, type);
          break;
        }
        default:
          ok = await this.configService.isConnected(tenantId, type);
      }

      if (ok) {
        await this.configService.markConnected(tenantId, type);
        return { ok: true, message: 'Connection successful' };
      } else {
        await this.configService.markError(tenantId, type, 'Integration not connected');
        return { ok: false, message: 'Integration is not connected' };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection test failed';
      await this.configService.markError(tenantId, type, message);
      return { ok: false, message };
    }
  }
}
