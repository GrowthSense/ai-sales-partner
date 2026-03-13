import { Injectable, Logger } from '@nestjs/common';
import { ICrmAdapter, LeadPayload, CrmConfig } from '../../interfaces/crm-adapter.interface';

/**
 * MockCrmClient — no-op CRM adapter for development and testing.
 *
 * Returns predictable fake IDs without making any HTTP calls.
 * Used automatically when no real CRM integration is configured.
 */
@Injectable()
export class MockCrmClient implements ICrmAdapter {
  private readonly logger = new Logger(MockCrmClient.name);
  private readonly contacts = new Map<string, string>(); // email → id

  async createContact(lead: LeadPayload, _config: CrmConfig): Promise<string> {
    const id = `mock-crm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (lead.email) this.contacts.set(lead.email, id);
    this.logger.debug(`[mock-crm] createContact: email=${lead.email} → id=${id}`);
    return id;
  }

  async updateContact(crmId: string, lead: LeadPayload, _config: CrmConfig): Promise<void> {
    this.logger.debug(`[mock-crm] updateContact: id=${crmId} email=${lead.email}`);
  }

  async findByEmail(email: string, _config: CrmConfig): Promise<string | null> {
    const id = this.contacts.get(email) ?? null;
    this.logger.debug(`[mock-crm] findByEmail: email=${email} → ${id ?? 'not found'}`);
    return id;
  }
}
