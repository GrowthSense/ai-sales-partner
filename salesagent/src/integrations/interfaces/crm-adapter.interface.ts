// All CRM integrations implement this adapter interface.
// Allows seamless swapping between HubSpot and Salesforce.
export interface ICrmAdapter {
  createContact(lead: LeadPayload, config: CrmConfig): Promise<string>;   // returns crmId
  updateContact(crmId: string, lead: LeadPayload, config: CrmConfig): Promise<void>;
  findByEmail(email: string, config: CrmConfig): Promise<string | null>;
}

export interface LeadPayload {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  notes?: string;
  source?: string;   // 'salesagent-widget'
  score?: number;
  status?: string;
}

export interface CrmConfig {
  apiKey?: string;
  accessToken?: string;
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
}
