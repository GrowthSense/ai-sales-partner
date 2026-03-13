import { Injectable, Logger } from '@nestjs/common';
import { ICrmAdapter, LeadPayload, CrmConfig } from '../../interfaces/crm-adapter.interface';

const BASE_URL = 'https://api.hubapi.com/crm/v3';

/**
 * HubspotClient — implements ICrmAdapter using HubSpot Contacts API v3.
 *
 * Auth: Private App token via Bearer header (recommended over API keys).
 * Pass token as CrmConfig.apiKey.
 *
 * Field mappings:
 *   firstName → firstname, lastName → lastname
 *   company → company, jobTitle → jobtitle
 *   source → hs_lead_status (set to "salesagent-widget")
 */
@Injectable()
export class HubspotClient implements ICrmAdapter {
  private readonly logger = new Logger(HubspotClient.name);

  async createContact(lead: LeadPayload, config: CrmConfig): Promise<string> {
    const properties = this.toHubSpotProperties(lead);

    const response = await this.request(
      'POST',
      '/objects/contacts',
      config,
      { properties },
    );

    return String(response.id);
  }

  async updateContact(crmId: string, lead: LeadPayload, config: CrmConfig): Promise<void> {
    const properties = this.toHubSpotProperties(lead);

    await this.request(
      'PATCH',
      `/objects/contacts/${encodeURIComponent(crmId)}`,
      config,
      { properties },
    );
  }

  async findByEmail(email: string, config: CrmConfig): Promise<string | null> {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: 'email', operator: 'EQ', value: email },
          ],
        },
      ],
      properties: ['email'],
      limit: 1,
    };

    const response = await this.request(
      'POST',
      '/objects/contacts/search',
      config,
      body,
    );

    const results = response.results as Array<{ id: string }> | undefined;
    return results && results.length > 0 ? String(results[0].id) : null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toHubSpotProperties(lead: LeadPayload): Record<string, string> {
    const props: Record<string, string> = {};

    if (lead.email) props['email'] = lead.email;
    if (lead.phone) props['phone'] = lead.phone;
    if (lead.firstName) props['firstname'] = lead.firstName;
    if (lead.lastName) props['lastname'] = lead.lastName;
    if (lead.company) props['company'] = lead.company;
    if (lead.jobTitle) props['jobtitle'] = lead.jobTitle;
    if (lead.notes) props['hs_content_membership_notes'] = lead.notes;
    if (lead.source) props['hs_lead_status'] = lead.source;

    return props;
  }

  private async request(
    method: string,
    path: string,
    config: CrmConfig,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`HubSpot API ${method} ${path} → ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`HubSpot API error ${response.status}: ${err.slice(0, 200)}`);
    }

    if (response.status === 204) return {};
    return response.json() as Promise<Record<string, unknown>>;
  }
}
