/**
 * BullMQ job payload types — shared contracts between producers and workers.
 * All jobs MUST include tenantId for multi-tenant isolation.
 *
 * Retry conventions (applied via queue.add() options or queue defaultJobOptions):
 *   RETRY_CONFIGS.<KEY>  — use these instead of inline magic numbers
 */

// ─── Job payload interfaces ───────────────────────────────────────────────────

export interface AgentResponseJob {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

export interface RagIngestJob {
  tenantId: string;
  documentId: string;
}

export interface CrmSyncJob {
  tenantId: string;
  leadId: string;
}

export interface FollowUpJob {
  tenantId: string;
  leadId: string;
  workflowId: string;
  executionId: string;
  stepIndex: number;
}

/**
 * Webhook delivery job.
 * The actual endpoint URL is resolved server-side from tenant integration config
 * so we never expose it in the job payload (queue contents are logged).
 */
export interface NotificationJob {
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
  /** Optional idempotency key — prevents duplicate deliveries on retry. */
  idempotencyKey?: string;
}

export interface AnalyticsAggregationJob {
  tenantId: string;
  /** ISO date string (YYYY-MM-DD) for the day to aggregate. */
  date: string;
  /** Granularity of the snapshot. */
  granularity: 'daily';
}

/** Fetches new comments from a connected social account via platform API. */
export interface SocialCommentFetchJob {
  tenantId: string;
  accountId: string;
}

/** Runs OpenAI sentiment + lead-signal analysis on a single raw comment. */
export interface SocialCommentAnalyzeJob {
  tenantId: string;
  commentId: string;
}

// ─── Queue names ─────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  AGENT_RESPONSE: 'agent-response',
  RAG_INGEST: 'rag-ingest',
  CRM_SYNC: 'crm-sync',
  FOLLOW_UP: 'follow-up',
  NOTIFICATIONS: 'notifications',
  ANALYTICS_AGGREGATION: 'analytics-aggregation',
  SOCIAL_COMMENT_FETCH: 'social-comment-fetch',
  SOCIAL_COMMENT_ANALYZE: 'social-comment-analyze',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Retry configuration presets ─────────────────────────────────────────────

/**
 * Standardised retry configurations.
 * All delays are in milliseconds.
 *
 * Usage:
 *   queue.add('job-name', data, RETRY_CONFIGS.TRANSIENT)
 */
export const RETRY_CONFIGS = {
  /**
   * Short-lived operations that should succeed quickly.
   * Agent response fallback — retried aggressively because the visitor is waiting.
   */
  AGGRESSIVE: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },

  /**
   * Standard retry for transient failures (network blips, brief service outages).
   * RAG ingest, analytics aggregation.
   */
  TRANSIENT: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },

  /**
   * Resilient retry for external integrations that may have rate limits or downtime.
   * CRM sync, webhook delivery.
   * Max wait ≈ 5s * (2^0 + 2^1 + 2^2 + 2^3 + 2^4) = 5s * 31 = ~2.5 min total.
   */
  RESILIENT: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },

  /**
   * Lenient retry for follow-up jobs that can be delayed longer.
   * Follow-up email sequences — a few hours of delay is acceptable.
   */
  LENIENT: {
    attempts: 4,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: 50,
    removeOnFail: 500,
  },
} as const;
