// ─── User ─────────────────────────────────────────────────────────────────────
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

// ─── Tenant / Member ──────────────────────────────────────────────────────────
export enum TenantPlan {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

export enum TenantMemberRole {
  OWNER = 'owner',     // one per tenant, cannot be removed
  ADMIN = 'admin',     // full CRUD
  MEMBER = 'member',   // read-only + conversation view
}

export enum TenantMemberStatus {
  PENDING = 'pending',   // invite sent, not yet accepted
  ACTIVE = 'active',
  DEACTIVATED = 'deactivated',
}

// ─── Integration ──────────────────────────────────────────────────────────────
export enum IntegrationType {
  CRM_HUBSPOT = 'crm_hubspot',
  CRM_SALESFORCE = 'crm_salesforce',
  CALENDAR_CALENDLY = 'calendar_calendly',
  CALENDAR_CALCOM = 'calendar_calcom',
  CALENDAR_GOOGLE_MEET = 'calendar_google_meet',
  CALENDAR_MICROSOFT_TEAMS = 'calendar_microsoft_teams',
  EMAIL_SMTP = 'email_smtp',
  WEBHOOK = 'webhook',
}

export enum IntegrationStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
}

// ─── Agent ────────────────────────────────────────────────────────────────────
export enum AgentStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum AgentSessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
}

// ─── Conversation ─────────────────────────────────────────────────────────────
export enum ConversationStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
  ABANDONED = 'abandoned',  // visitor left without interacting
  PAUSED = 'paused',        // human handoff in progress
}

export enum ConversationStage {
  GREETING = 'greeting',
  DISCOVERY = 'discovery',
  QUALIFICATION = 'qualification',
  RECOMMENDATION = 'recommendation',
  OBJECTION_HANDLING = 'objection_handling',
  CONVERSION = 'conversion',
  SCHEDULING = 'scheduling',
  FOLLOW_UP = 'follow_up',
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
  SYSTEM = 'system',
}

// ─── Lead ─────────────────────────────────────────────────────────────────────
export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  UNQUALIFIED = 'unqualified',
  DEMO_SCHEDULED = 'demo_scheduled',
  CONVERTED = 'converted',
  LOST = 'lost',
}

export enum LeadSource {
  WEBSITE_CHAT = 'website_chat',
  API = 'api',
  MANUAL = 'manual',
  IMPORT = 'import',
  SOCIAL_MEDIA = 'social_media',
}

// ─── Social Media ──────────────────────────────────────────────────────────────
export enum SocialPlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  TWITTER = 'twitter',
  LINKEDIN = 'linkedin',
}

export enum CommentSentiment {
  POSITIVE = 'positive',
  NEUTRAL = 'neutral',
  NEGATIVE = 'negative',
  CRITICAL = 'critical',
}

export enum SocialAccountStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

export enum NegativeAlertStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

export enum LeadActivityType {
  CREATED = 'created',
  STAGE_CHANGED = 'stage_changed',
  NOTE_ADDED = 'note_added',
  EMAIL_SENT = 'email_sent',
  CRM_SYNCED = 'crm_synced',
  MEETING_SCHEDULED = 'meeting_scheduled',
  MEETING_COMPLETED = 'meeting_completed',
  CONVERTED = 'converted',
  LOST = 'lost',
}

export enum MeetingStatus {
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export enum MeetingType {
  DEMO = 'demo',
  DISCOVERY_CALL = 'discovery_call',
  FOLLOW_UP = 'follow_up',
  ONBOARDING = 'onboarding',
}

// ─── Skills / Tools ───────────────────────────────────────────────────────────
export enum SkillType {
  BUILT_IN = 'built_in',
  MCP = 'mcp',
  CUSTOM = 'custom',
}

export enum ToolType {
  HTTP = 'http',
  FUNCTION = 'function',
  MCP = 'mcp',
}

export enum MCPProviderStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SYNC_ERROR = 'sync_error',
}

// ─── Knowledge ────────────────────────────────────────────────────────────────
export enum DocumentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum DocumentSourceType {
  UPLOAD = 'upload',
  URL = 'url',
  MANUAL = 'manual',
  SYNC = 'sync',
}

// ─── Workflow ─────────────────────────────────────────────────────────────────
export enum WorkflowJobType {
  CRM_SYNC = 'crm_sync',
  FOLLOW_UP_EMAIL = 'follow_up_email',
  LEAD_SCORE_UPDATE = 'lead_score_update',
  WEBHOOK_DELIVERY = 'webhook_delivery',
  KNOWLEDGE_INGEST = 'knowledge_ingest',
}

export enum WorkflowJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  EXPORT = 'export',
  INTEGRATION_CONNECTED = 'integration_connected',
  INTEGRATION_DISCONNECTED = 'integration_disconnected',
  AGENT_DEPLOYED = 'agent_deployed',
  KNOWLEDGE_UPLOADED = 'knowledge_uploaded',
}

export enum AuditEntityType {
  TENANT = 'tenant',
  USER = 'user',
  AGENT = 'agent',
  LEAD = 'lead',
  CONVERSATION = 'conversation',
  KNOWLEDGE_DOCUMENT = 'knowledge_document',
  INTEGRATION = 'integration',
  MCP_PROVIDER = 'mcp_provider',
}
