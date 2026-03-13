export interface TenantSettings {
  branding: {
    primaryColor: string;
    logoUrl: string;
    agentName: string;
    greetingMessage: string;
  };
  allowedDomains: string[];     // CORS for widget embed
  timezone: string;
  crmConfig?: {
    provider: 'hubspot' | 'salesforce' | null;
    apiKey?: string;
  };
  calendarConfig?: {
    provider: 'calendly' | 'calcom' | null;
    apiKey?: string;
  };
}

export enum TenantPlan {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}
