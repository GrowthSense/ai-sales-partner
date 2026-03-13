import * as Joi from 'joi';

/**
 * Environment variable validation schema.
 *
 * All required variables without defaults will throw on application startup
 * if not provided, preventing silent misconfiguration in production.
 *
 * Used by ConfigModule.forRoot({ validationSchema }) in AppModule.
 */
export const configSchema = Joi.object({
  // ── Application ───────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  DATABASE_SSL: Joi.boolean().default(false),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // ── OpenAI / OpenRouter ───────────────────────────────────────────────────
  OPENAI_API_KEY: Joi.string().pattern(/^sk-/).required(),
  OPENAI_BASE_URL: Joi.string().uri().optional().allow(''),
  OPENROUTER_API_KEY: Joi.string().optional().allow(''),
  OPENAI_MODEL: Joi.string().default('gpt-4o'),
  OPENAI_EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  OPENAI_EMBEDDING_DIMENSIONS: Joi.number().integer().default(1536),
  OPENAI_MAX_TOKENS: Joi.number().integer().min(256).max(32768).default(4096),
  OPENAI_TEMPERATURE: Joi.number().min(0).max(2).default(0.3),

  // ── JWT ───────────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_WIDGET_SECRET: Joi.string().min(32).required(),
  JWT_WIDGET_EXPIRES_IN: Joi.string().default('24h'),

  // ── Encryption ────────────────────────────────────────────────────────────
  // 64-char hex string = 32 bytes for AES-256-GCM
  ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  // ── Super Admin ───────────────────────────────────────────────────────────
  SUPER_ADMIN_EMAIL: Joi.string().email().optional(),

  // ── RAG ───────────────────────────────────────────────────────────────────
  RAG_CHUNK_SIZE: Joi.number().integer().min(128).max(2048).default(512),
  RAG_CHUNK_OVERLAP: Joi.number().integer().min(0).max(512).default(100),
  RAG_TOP_K_RETRIEVAL: Joi.number().integer().min(1).max(100).default(20),
  RAG_TOP_K_RERANK: Joi.number().integer().min(1).max(20).default(5),
  RAG_RETRIEVAL_TIMEOUT_MS: Joi.number().integer().min(50).max(5000).default(300),

  // ── Agent Orchestration ───────────────────────────────────────────────────
  AGENT_MAX_TOOL_ITERATIONS: Joi.number().integer().min(1).max(10).default(3),
  AGENT_HISTORY_TOKEN_BUDGET: Joi.number().integer().min(4000).default(80000),
  AGENT_MIN_HISTORY_MESSAGES: Joi.number().integer().min(1).default(20),

  // ── CRM integrations (all optional) ──────────────────────────────────────
  HUBSPOT_API_KEY: Joi.string().optional().allow(''),
  SALESFORCE_CLIENT_ID: Joi.string().optional().allow(''),
  SALESFORCE_CLIENT_SECRET: Joi.string().optional().allow(''),
  SALESFORCE_INSTANCE_URL: Joi.string().uri().optional().allow(''),

  // ── Calendar integrations (all optional) ─────────────────────────────────
  CALENDLY_API_KEY: Joi.string().optional().allow(''),
  CALCOM_API_KEY: Joi.string().optional().allow(''),
  CALCOM_BASE_URL: Joi.string().uri().optional().default('https://api.cal.com/v1'),

  // ── Email (optional) ──────────────────────────────────────────────────────
  SMTP_HOST: Joi.string().optional().allow(''),
  SMTP_PORT: Joi.number().integer().min(1).max(65535).default(587),
  SMTP_USER: Joi.string().optional().allow(''),
  SMTP_PASS: Joi.string().optional().allow(''),
  EMAIL_FROM: Joi.string().email().optional().allow(''),

  // ── MCP ───────────────────────────────────────────────────────────────────
  MCP_CALL_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(10000),
  MCP_MAX_RESPONSE_BYTES: Joi.number().integer().min(1024).default(51200),
});
