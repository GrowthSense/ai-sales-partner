import { Injectable, Logger } from '@nestjs/common';
import { ICrmAdapter, LeadPayload, CrmConfig } from '../../interfaces/crm-adapter.interface';

/**
 * SalesforceClient — implements ICrmAdapter for Salesforce REST API.
 *
 * Auth: OAuth2 client credentials flow.
 *   config.instanceUrl — e.g. https://myorg.salesforce.com
 *   config.accessToken — short-lived Bearer token
 *   config.clientId / clientSecret — for token refresh (simplified here)
 *
 * Maps leads to Salesforce Contact object.
 */
@Injectable()
export class SalesforceClient implements ICrmAdapter {
  private readonly logger = new Logger(SalesforceClient.name);
  private readonly API_VERSION = 'v59.0';

  async createContact(lead: LeadPayload, config: CrmConfig): Promise<string> {
    const body = this.toSalesforceContact(lead);
    const response = await this.request(
      'POST',
      `/services/data/${this.API_VERSION}/sobjects/Contact/`,
      config,
      body,
    );
    return String(response.id);
  }

  async updateContact(crmId: string, lead: LeadPayload, config: CrmConfig): Promise<void> {
    const body = this.toSalesforceContact(lead);
    await this.request(
      'PATCH',
      `/services/data/${this.API_VERSION}/sobjects/Contact/${encodeURIComponent(crmId)}`,
      config,
      body,
    );
  }

  async findByEmail(email: string, config: CrmConfig): Promise<string | null> {
    const query = `SELECT Id FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`;
    const response = await this.request(
      'GET',
      `/services/data/${this.API_VERSION}/query?q=${encodeURIComponent(query)}`,
      config,
    );

    const records = response.records as Array<{ Id: string }> | undefined;
    return records && records.length > 0 ? String(records[0].Id) : null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toSalesforceContact(lead: LeadPayload): Record<string, string | undefined> {
    return {
      FirstName: lead.firstName,
      LastName: lead.lastName ?? lead.firstName ?? 'Unknown',
      Email: lead.email,
      Phone: lead.phone,
      AccountName: lead.company,
      Title: lead.jobTitle,
      Description: lead.notes,
      LeadSource: lead.source,
    };
  }

  private async request(
    method: string,
    path: string,
    config: CrmConfig,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    if (!config.instanceUrl) {
      throw new Error('Salesforce instanceUrl is required');
    }

    const url = `${config.instanceUrl.replace(/\/$/, '')}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken ?? config.apiKey}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`Salesforce ${method} ${path} → ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`Salesforce API error ${response.status}: ${err.slice(0, 200)}`);
    }

    if (response.status === 204) return {};
    return response.json() as Promise<Record<string, unknown>>;
  }
}
