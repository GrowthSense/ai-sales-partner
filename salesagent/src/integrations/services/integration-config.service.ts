import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantIntegration, IntegrationCredentials } from '../../tenants/entities/tenant-integration.entity';
import { IntegrationType, IntegrationStatus } from '../../common/enums';
import { EncryptionService } from '../../common/services/encryption.service';

export interface CrmCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface GoogleMeetCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface MicrosoftTeamsCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface EmailCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export interface WhatsAppCredentials {
  accessToken: string;
  verifyToken?: string;
}

export interface WebhookCredentials {
  signingSecret?: string;
}

type IntegrationCredentialMap = {
  [IntegrationType.CRM_HUBSPOT]: CrmCredentials;
  [IntegrationType.CRM_SALESFORCE]: CrmCredentials;
  [IntegrationType.CALENDAR_GOOGLE_MEET]: GoogleMeetCredentials;
  [IntegrationType.CALENDAR_MICROSOFT_TEAMS]: MicrosoftTeamsCredentials;
  [IntegrationType.WHATSAPP_BUSINESS]: WhatsAppCredentials;
  [IntegrationType.EMAIL_SMTP]: EmailCredentials;
  [IntegrationType.WEBHOOK]: WebhookCredentials;
};

/**
 * IntegrationConfigService
 *
 * The single source of truth for loading and decrypting per-tenant
 * integration credentials. Called by all adapter facades before making
 * API calls.
 *
 * Credentials are decrypted from the TenantIntegration.credentials JSONB
 * using AES-256-GCM (EncryptionService). The plaintext is never stored
 * or logged.
 *
 * The `select: false` on TenantIntegration.credentials means normal
 * findOne() calls won't load it — this service always uses an explicit
 * addSelect() to opt-in.
 */
@Injectable()
export class IntegrationConfigService {
  private readonly logger = new Logger(IntegrationConfigService.name);

  constructor(
    @InjectRepository(TenantIntegration)
    private readonly integrationRepo: Repository<TenantIntegration>,

    private readonly encryption: EncryptionService,
  ) {}

  // ─── Config loading ───────────────────────────────────────────────────────

  /**
   * Load the integration record without credentials (non-sensitive config only).
   * Safe to return to callers that only need provider settings (e.g. eventTypeId).
   */
  async getConfig(tenantId: string, type: IntegrationType): Promise<TenantIntegration> {
    const record = await this.integrationRepo.findOne({ where: { tenantId, type } });

    if (!record) {
      throw new NotFoundException(
        `Integration ${type} not configured for tenant ${tenantId}`,
      );
    }

    if (record.status !== IntegrationStatus.CONNECTED) {
      throw new UnprocessableEntityException(
        `Integration ${type} is not connected (status: ${record.status})`,
      );
    }

    return record;
  }

  /**
   * Load and decrypt credentials for the given integration type.
   * Returns typed credentials — never null for connected integrations.
   */
  async getCredentials<T extends IntegrationType>(
    tenantId: string,
    type: T,
  ): Promise<IntegrationCredentialMap[T]> {
    // Must opt-in to `credentials` since select: false
    const record = await this.integrationRepo
      .createQueryBuilder('ti')
      .addSelect('ti.credentials')
      .where('ti.tenant_id = :tenantId', { tenantId })
      .andWhere('ti.type = :type', { type })
      .getOne();

    if (!record) {
      throw new NotFoundException(
        `Integration ${type} not configured for tenant ${tenantId}`,
      );
    }

    if (record.status !== IntegrationStatus.CONNECTED) {
      throw new UnprocessableEntityException(
        `Integration ${type} is not connected (status: ${record.status})`,
      );
    }

    if (!record.credentials) {
      throw new UnprocessableEntityException(
        `Integration ${type} has no stored credentials`,
      );
    }

    return this.decryptCredentials<IntegrationCredentialMap[T]>(record.credentials);
  }

  /**
   * Load both the record (config) and its decrypted credentials in one call.
   * Used by adapter facades that need both non-secret config and secret keys.
   */
  async getConfigAndCredentials<T extends IntegrationType>(
    tenantId: string,
    type: T,
  ): Promise<{ record: TenantIntegration; credentials: IntegrationCredentialMap[T] }> {
    const record = await this.integrationRepo
      .createQueryBuilder('ti')
      .addSelect('ti.credentials')
      .where('ti.tenant_id = :tenantId', { tenantId })
      .andWhere('ti.type = :type', { type })
      .getOne();

    if (!record) {
      throw new NotFoundException(
        `Integration ${type} not configured for tenant ${tenantId}`,
      );
    }

    if (record.status !== IntegrationStatus.CONNECTED) {
      throw new UnprocessableEntityException(
        `Integration ${type} is not connected (status: ${record.status})`,
      );
    }

    if (!record.credentials) {
      throw new UnprocessableEntityException(
        `Integration ${type} has no stored credentials`,
      );
    }

    const credentials = this.decryptCredentials<IntegrationCredentialMap[T]>(
      record.credentials,
    );

    return { record, credentials };
  }

  /**
   * Check whether an integration is connected — safe for use in skill
   * pre-flight checks without loading credentials.
   */
  async isConnected(tenantId: string, type: IntegrationType): Promise<boolean> {
    const count = await this.integrationRepo.count({
      where: { tenantId, type, status: IntegrationStatus.CONNECTED },
    });
    return count > 0;
  }

  // ─── Credential encryption helpers ───────────────────────────────────────

  /**
   * Encrypt raw credentials and return the encrypted blob for persistence.
   * Called by the tenant admin controller when saving integration settings.
   */
  encryptCredentials(raw: Record<string, unknown>): IntegrationCredentials {
    return this.encryption.encryptJson(raw);
  }

  private decryptCredentials<T>(encrypted: IntegrationCredentials): T {
    try {
      return this.encryption.decryptJson<T>(encrypted);
    } catch {
      this.logger.error('Credential decryption failed — ENCRYPTION_KEY mismatch?');
      throw new UnprocessableEntityException('Failed to decrypt integration credentials');
    }
  }

  // ─── Status management ────────────────────────────────────────────────────

  async markError(tenantId: string, type: IntegrationType, message: string): Promise<void> {
    await this.integrationRepo.update(
      { tenantId, type },
      { status: IntegrationStatus.ERROR, errorMessage: message },
    );
  }

  async markConnected(tenantId: string, type: IntegrationType): Promise<void> {
    await this.integrationRepo.update(
      { tenantId, type },
      {
        status: IntegrationStatus.CONNECTED,
        errorMessage: null,
        connectedAt: new Date(),
        lastUsedAt: new Date(),
      },
    );
  }

  async touchLastUsed(tenantId: string, type: IntegrationType): Promise<void> {
    await this.integrationRepo.update({ tenantId, type }, { lastUsedAt: new Date() });
  }
}
