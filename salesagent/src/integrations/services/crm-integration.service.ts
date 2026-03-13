import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from './integration-config.service';
import { HubspotClient } from '../crm/hubspot/hubspot.client';
import { SalesforceClient } from '../crm/salesforce/salesforce.client';
import { MockCrmClient } from '../crm/mock/mock-crm.client';
import { ICrmAdapter, LeadPayload, CrmConfig } from '../interfaces/crm-adapter.interface';
import { IntegrationType } from '../../common/enums';

export interface CrmPushResult {
  crmId: string;
  provider: string;
  isNew: boolean;
}

/**
 * CrmIntegrationService — facade over HubSpot and Salesforce adapters.
 *
 * Resolves the correct adapter from the tenant's integration config,
 * checks for an existing contact by email, then creates or updates.
 *
 * Skills call this via SkillContext.services.invokeIntegration('crm', 'push', args).
 * The orchestrator dispatches to this service.
 */
@Injectable()
export class CrmIntegrationService {
  private readonly logger = new Logger(CrmIntegrationService.name);

  constructor(
    private readonly configService: IntegrationConfigService,
    private readonly hubspot: HubspotClient,
    private readonly salesforce: SalesforceClient,
    private readonly mockCrm: MockCrmClient,
  ) {}

  async push(tenantId: string, lead: LeadPayload): Promise<CrmPushResult> {
    // Try HubSpot first, then Salesforce (tenant has at most one active CRM)
    const provider = await this.resolveProvider(tenantId);

    this.logger.debug(`CRM push: tenantId=${tenantId} provider=${provider.name} email=${lead.email}`);

    const config = provider.config;
    const adapter = provider.adapter;

    // Idempotency: check for existing contact by email
    let crmId: string | null = null;
    let isNew = true;

    if (lead.email) {
      crmId = await adapter.findByEmail(lead.email, config).catch(() => null);
    }

    if (crmId) {
      await adapter.updateContact(crmId, lead, config);
      isNew = false;
    } else {
      crmId = await adapter.createContact(lead, config);
    }

    await this.configService.touchLastUsed(tenantId, provider.integrationType);

    this.logger.debug(`CRM ${isNew ? 'created' : 'updated'} contact: crmId=${crmId}`);
    return { crmId, provider: provider.name, isNew };
  }

  // ─── Provider resolution ──────────────────────────────────────────────────

  private async resolveProvider(tenantId: string): Promise<{
    name: string;
    adapter: ICrmAdapter;
    config: CrmConfig;
    integrationType: IntegrationType;
  }> {
    // Check HubSpot first
    const hasHubspot = await this.configService.isConnected(tenantId, IntegrationType.CRM_HUBSPOT);
    if (hasHubspot) {
      const creds = await this.configService.getCredentials(tenantId, IntegrationType.CRM_HUBSPOT);
      return {
        name: 'hubspot',
        adapter: this.hubspot,
        config: { apiKey: creds.apiKey ?? creds.accessToken },
        integrationType: IntegrationType.CRM_HUBSPOT,
      };
    }

    const hasSalesforce = await this.configService.isConnected(tenantId, IntegrationType.CRM_SALESFORCE);
    if (hasSalesforce) {
      const creds = await this.configService.getCredentials(tenantId, IntegrationType.CRM_SALESFORCE);
      return {
        name: 'salesforce',
        adapter: this.salesforce,
        config: {
          accessToken: creds.accessToken,
          instanceUrl: creds.instanceUrl,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
        },
        integrationType: IntegrationType.CRM_SALESFORCE,
      };
    }

    // No real CRM connected — use mock (dev / staging)
    this.logger.warn(`No CRM integration connected for tenant ${tenantId} — using mock`);
    return {
      name: 'mock',
      adapter: this.mockCrm,
      config: {},
      integrationType: IntegrationType.CRM_HUBSPOT, // placeholder
    };
  }
}
