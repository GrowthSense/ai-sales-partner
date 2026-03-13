import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * InitialSchema — creates every table, enum type, index, and FK constraint
 * for the Sales Agent SaaS platform.
 *
 * Order of table creation follows FK dependency:
 *   tenants → users → tenant_members → tenant_integrations
 *   → refresh_tokens → agent_configs → agents → agent_sessions / agent_states
 *   → conversations → conversation_messages
 *   → leads → lead_activities → meetings
 *   → knowledge_documents → knowledge_chunks → embeddings
 *   → mcp_providers / mcp_servers
 *   → workflows → workflow_executions → workflow_jobs
 *   → analytics_daily_snapshots
 *   → audit_logs
 *
 * pgvector:
 *   Embeddings.vector column is declared TEXT then altered to vector(1536)
 *   and the HNSW index is created after. This is required because TypeORM
 *   does not understand the 'vector' column type natively.
 *
 * Full-text search:
 *   GIN index on knowledge_chunks.content using to_tsvector is created
 *   at the end for BM25-style keyword retrieval in hybrid RAG search.
 */
export class InitialSchema1741737600000 implements MigrationInterface {
  name = 'InitialSchema1741737600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Extensions ──────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // pgvector — optional: vector similarity search. Install postgresql-17-pgvector to enable.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE EXTENSION IF NOT EXISTS "vector";
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pgvector extension not available — vector search disabled. Install postgresql-17-pgvector to enable.';
      END $$;
    `);

    // ─── Enum types ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE user_status_enum AS ENUM ('active', 'inactive', 'suspended')
    `);

    await queryRunner.query(`
      CREATE TYPE tenant_plan_enum AS ENUM ('free', 'starter', 'pro', 'enterprise')
    `);

    await queryRunner.query(`
      CREATE TYPE tenant_member_role_enum AS ENUM ('owner', 'admin', 'member')
    `);

    await queryRunner.query(`
      CREATE TYPE tenant_member_status_enum AS ENUM ('pending', 'active', 'deactivated')
    `);

    await queryRunner.query(`
      CREATE TYPE integration_type_enum AS ENUM (
        'crm_hubspot', 'crm_salesforce',
        'calendar_calendly', 'calendar_calcom',
        'email_smtp', 'webhook'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE integration_status_enum AS ENUM ('connected', 'disconnected', 'error')
    `);

    await queryRunner.query(`
      CREATE TYPE agent_status_enum AS ENUM ('draft', 'active', 'inactive')
    `);

    await queryRunner.query(`
      CREATE TYPE agent_session_status_enum AS ENUM ('active', 'completed', 'failed', 'timed_out')
    `);

    await queryRunner.query(`
      CREATE TYPE conversation_status_enum AS ENUM ('active', 'ended', 'abandoned', 'paused')
    `);

    await queryRunner.query(`
      CREATE TYPE conversation_stage_enum AS ENUM (
        'greeting', 'discovery', 'qualification', 'recommendation',
        'objection_handling', 'conversion', 'scheduling', 'follow_up'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE message_role_enum AS ENUM ('user', 'assistant', 'tool', 'system')
    `);

    await queryRunner.query(`
      CREATE TYPE lead_status_enum AS ENUM (
        'new', 'contacted', 'qualified', 'unqualified',
        'demo_scheduled', 'converted', 'lost'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE lead_source_enum AS ENUM ('website_chat', 'api', 'manual', 'import')
    `);

    await queryRunner.query(`
      CREATE TYPE lead_activity_type_enum AS ENUM (
        'created', 'stage_changed', 'note_added', 'email_sent',
        'crm_synced', 'meeting_scheduled', 'meeting_completed', 'converted', 'lost'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE meeting_status_enum AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show')
    `);

    await queryRunner.query(`
      CREATE TYPE meeting_type_enum AS ENUM ('demo', 'discovery_call', 'follow_up', 'onboarding')
    `);

    await queryRunner.query(`
      CREATE TYPE document_status_enum AS ENUM ('pending', 'processing', 'ready', 'failed')
    `);

    await queryRunner.query(`
      CREATE TYPE document_source_type_enum AS ENUM ('upload', 'url', 'manual', 'sync')
    `);

    await queryRunner.query(`
      CREATE TYPE mcp_provider_status_enum AS ENUM ('active', 'inactive', 'sync_error')
    `);

    await queryRunner.query(`
      CREATE TYPE workflow_trigger_enum AS ENUM (
        'conversation_ended', 'lead_qualified', 'demo_scheduled', 'lead_lost'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE workflow_job_type_enum AS ENUM (
        'crm_sync', 'follow_up_email', 'lead_score_update',
        'webhook_delivery', 'knowledge_ingest'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE workflow_job_status_enum AS ENUM (
        'pending', 'running', 'completed', 'failed', 'cancelled', 'retrying'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE audit_action_enum AS ENUM (
        'create', 'update', 'delete', 'login', 'logout', 'export',
        'integration_connected', 'integration_disconnected',
        'agent_deployed', 'knowledge_uploaded'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE audit_entity_type_enum AS ENUM (
        'tenant', 'user', 'agent', 'lead', 'conversation',
        'knowledge_document', 'integration', 'mcp_provider'
      )
    `);

    // ─── tenants ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE tenants (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(255) NOT NULL,
        slug        VARCHAR(100) NOT NULL UNIQUE,
        widget_key  UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        plan        tenant_plan_enum NOT NULL DEFAULT 'free',
        is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
        settings    JSONB        NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_tenants_plan ON tenants (plan)`);
    await queryRunner.query(`CREATE INDEX idx_tenants_is_active ON tenants (is_active)`);

    // ─── users ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE users (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email          VARCHAR(255) NOT NULL UNIQUE,
        password_hash  VARCHAR(255) NOT NULL,
        first_name     VARCHAR(100),
        last_name      VARCHAR(100),
        avatar_url     VARCHAR(255),
        status         user_status_enum NOT NULL DEFAULT 'active',
        last_login_at  TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_users_email ON users (email)`);
    await queryRunner.query(`CREATE INDEX idx_users_status ON users (status)`);

    // ─── tenant_members ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE tenant_members (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role              tenant_member_role_enum   NOT NULL DEFAULT 'member',
        status            tenant_member_status_enum NOT NULL DEFAULT 'pending',
        invited_email     VARCHAR(255) NOT NULL,
        invite_token      UUID,
        invite_expires_at TIMESTAMPTZ,
        accepted_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_tenant_members_tenant_user ON tenant_members (tenant_id, user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tenant_members_tenant_role ON tenant_members (tenant_id, role)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tenant_members_tenant_status ON tenant_members (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tenant_members_user_id ON tenant_members (user_id)
    `);

    // ─── tenant_integrations ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE tenant_integrations (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type          integration_type_enum   NOT NULL,
        status        integration_status_enum NOT NULL DEFAULT 'disconnected',
        credentials   JSONB,
        config        JSONB        NOT NULL DEFAULT '{}',
        error_message TEXT,
        last_used_at  TIMESTAMPTZ,
        connected_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_tenant_integrations_type ON tenant_integrations (tenant_id, type)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tenant_integrations_status ON tenant_integrations (tenant_id, status)
    `);

    // ─── refresh_tokens ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id      UUID        NOT NULL,
        jti            UUID        NOT NULL UNIQUE,
        token_hash     VARCHAR(64) NOT NULL,
        expires_at     TIMESTAMPTZ NOT NULL,
        revoked_at     TIMESTAMPTZ,
        revoked_reason VARCHAR(20),
        user_agent     VARCHAR(512),
        ip_address     VARCHAR(45),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_user_revoked ON refresh_tokens (user_id, revoked_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_tenant_id ON refresh_tokens (tenant_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_refresh_tokens_jti ON refresh_tokens (jti)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at)
    `);

    // ─── agent_configs ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE agent_configs (
        id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        persona          TEXT  NOT NULL,
        fallback_message TEXT,
        llm_config       JSONB NOT NULL,
        stage_config     JSONB NOT NULL DEFAULT '{}',
        rag_config       JSONB NOT NULL,
        template_vars    JSONB NOT NULL DEFAULT '{}',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_configs_tenant_id ON agent_configs (tenant_id)
    `);

    // ─── agents ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE agents (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name           VARCHAR(255) NOT NULL,
        slug           VARCHAR(100) NOT NULL,
        description    TEXT,
        status         agent_status_enum NOT NULL DEFAULT 'draft',
        enabled_skills TEXT[]      NOT NULL DEFAULT '{}',
        config_id      UUID        REFERENCES agent_configs(id) ON DELETE SET NULL,
        deployed_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agents_tenant_status ON agents (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_agents_tenant_slug ON agents (tenant_id, slug)
    `);

    // ─── conversations ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE conversations (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id        UUID        REFERENCES agents(id) ON DELETE SET NULL,
        visitor_id      UUID        NOT NULL,
        status          conversation_status_enum NOT NULL DEFAULT 'active',
        current_stage   conversation_stage_enum  NOT NULL DEFAULT 'greeting',
        lead_id         UUID,
        metadata        JSONB       NOT NULL DEFAULT '{}',
        message_count   INT         NOT NULL DEFAULT 0,
        total_tokens    INT         NOT NULL DEFAULT 0,
        ended_at        TIMESTAMPTZ,
        last_message_at TIMESTAMPTZ,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_tenant_created ON conversations (tenant_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_tenant_status ON conversations (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_tenant_stage ON conversations (tenant_id, current_stage)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_tenant_visitor ON conversations (tenant_id, visitor_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_tenant_agent ON conversations (tenant_id, agent_id)
    `);

    // ─── agent_sessions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE agent_sessions (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id    UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        agent_id           UUID        REFERENCES agents(id) ON DELETE SET NULL,
        stage_at_start     conversation_stage_enum NOT NULL,
        stage_at_end       conversation_stage_enum,
        status             agent_session_status_enum NOT NULL DEFAULT 'active',
        input_message      TEXT        NOT NULL,
        output_message     TEXT,
        skill_executions   JSONB       NOT NULL DEFAULT '[]',
        iteration_count    SMALLINT    NOT NULL DEFAULT 0,
        token_usage        JSONB,
        latency_ms         INT,
        ttft_ms            INT,
        error_message      TEXT,
        completed_at       TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_sessions_tenant_conv ON agent_sessions (tenant_id, conversation_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_sessions_tenant_agent ON agent_sessions (tenant_id, agent_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_sessions_tenant_status ON agent_sessions (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_sessions_tenant_created ON agent_sessions (tenant_id, created_at)
    `);

    // ─── agent_states ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE agent_states (
        id                    UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             UUID     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id       UUID     NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        agent_id              UUID     REFERENCES agents(id) ON DELETE SET NULL,
        current_stage         conversation_stage_enum NOT NULL DEFAULT 'greeting',
        is_processing         BOOLEAN  NOT NULL DEFAULT FALSE,
        iteration_count       SMALLINT NOT NULL DEFAULT 0,
        working_memory        JSONB,
        pending_tool_call     JSONB,
        processing_started_at TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_agent_states_tenant_conv ON agent_states (tenant_id, conversation_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_states_tenant_processing ON agent_states (tenant_id, is_processing)
    `);

    // ─── conversation_messages ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE conversation_messages (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            message_role_enum NOT NULL,
        content         TEXT,
        tool_calls      JSONB,
        tool_call_id    VARCHAR(255),
        tool_name       VARCHAR(100),
        token_count     INT         NOT NULL DEFAULT 0,
        session_id      UUID,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conv_messages_conv_created
        ON conversation_messages (conversation_id, created_at ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conv_messages_tenant_created
        ON conversation_messages (tenant_id, created_at)
    `);

    // ─── leads ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE leads (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        visitor_id         UUID        NOT NULL,
        conversation_id    UUID        NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE RESTRICT,
        email              VARCHAR(255),
        phone              VARCHAR(50),
        first_name         VARCHAR(100),
        last_name          VARCHAR(100),
        company            VARCHAR(255),
        job_title          VARCHAR(255),
        status             lead_status_enum  NOT NULL DEFAULT 'new',
        source             lead_source_enum  NOT NULL DEFAULT 'website_chat',
        score              SMALLINT          NOT NULL DEFAULT 0,
        qualification_data JSONB             NOT NULL DEFAULT '{}',
        enrichment         JSONB,
        crm_id             VARCHAR(255),
        crm_synced_at      TIMESTAMPTZ,
        attribution        JSONB,
        deleted_at         TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_leads_tenant_status   ON leads (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_leads_tenant_score    ON leads (tenant_id, score)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_leads_tenant_email    ON leads (tenant_id, email)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_leads_tenant_created  ON leads (tenant_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_leads_tenant_visitor  ON leads (tenant_id, visitor_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_leads_conversation_id ON leads (conversation_id)
    `);

    // Add the FK from conversations.lead_id → leads.id now that leads exists
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD CONSTRAINT fk_conversations_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    `);

    // ─── lead_activities ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE lead_activities (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lead_id          UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        type             lead_activity_type_enum NOT NULL,
        description      TEXT        NOT NULL,
        previous_status  lead_status_enum,
        new_status       lead_status_enum,
        metadata         JSONB       NOT NULL DEFAULT '{}',
        actor_user_id    UUID,
        actor_type       VARCHAR(50) NOT NULL DEFAULT 'agent',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_lead_activities_tenant_lead_created
        ON lead_activities (tenant_id, lead_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_lead_activities_tenant_type ON lead_activities (tenant_id, type)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_lead_activities_lead_id ON lead_activities (lead_id)
    `);

    // ─── meetings ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE meetings (
        id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lead_id              UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        conversation_id      UUID        REFERENCES conversations(id) ON DELETE SET NULL,
        type                 meeting_type_enum   NOT NULL DEFAULT 'demo',
        status               meeting_status_enum NOT NULL DEFAULT 'scheduled',
        title                VARCHAR(255) NOT NULL,
        scheduled_at         TIMESTAMPTZ  NOT NULL,
        duration_minutes     INT          NOT NULL DEFAULT 30,
        booking_url          VARCHAR(2048),
        external_booking_id  VARCHAR(255),
        calendar_provider    VARCHAR(50),
        attendee_email       VARCHAR(255),
        attendee_name        VARCHAR(255),
        host_user_id         UUID,
        cancellation_reason  TEXT,
        completed_at         TIMESTAMPTZ,
        cancelled_at         TIMESTAMPTZ,
        post_meeting_notes   TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meetings_tenant_lead      ON meetings (tenant_id, lead_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meetings_tenant_status    ON meetings (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meetings_tenant_scheduled ON meetings (tenant_id, scheduled_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meetings_external_booking ON meetings (external_booking_id)
    `);

    // ─── knowledge_documents ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE knowledge_documents (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title           VARCHAR(512) NOT NULL,
        source_type     document_source_type_enum NOT NULL,
        source_url      VARCHAR(2048),
        storage_key     VARCHAR(1024),
        status          document_status_enum NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        chunk_count     INT          NOT NULL DEFAULT 0,
        ingestion_meta  JSONB,
        tags            TEXT[]       NOT NULL DEFAULT '{}',
        ingested_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_docs_tenant_status
        ON knowledge_documents (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_docs_tenant_source_type
        ON knowledge_documents (tenant_id, source_type)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_docs_tenant_created
        ON knowledge_documents (tenant_id, created_at)
    `);

    // ─── knowledge_chunks ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE knowledge_chunks (
        id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        document_id UUID  NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        content     TEXT  NOT NULL,
        metadata    JSONB NOT NULL,
        token_count INT   NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_chunks_tenant_id
        ON knowledge_chunks (tenant_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_chunks_tenant_doc
        ON knowledge_chunks (tenant_id, document_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_chunks_document_id
        ON knowledge_chunks (document_id)
    `);
    // GIN index for BM25-style full-text search (hybrid RAG keyword leg)
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_chunks_content_fts
        ON knowledge_chunks USING gin(to_tsvector('english', content))
    `);
    // pg_trgm index for ILIKE similarity search
    await queryRunner.query(`
      CREATE INDEX idx_knowledge_chunks_content_trgm
        ON knowledge_chunks USING gin(content gin_trgm_ops)
    `);

    // ─── embeddings ──────────────────────────────────────────────────────────
    // Declared as TEXT first; altered to vector(1536) below after table creation
    await queryRunner.query(`
      CREATE TABLE embeddings (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        chunk_id    UUID        NOT NULL UNIQUE REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        tenant_id   UUID        NOT NULL,
        model       VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
        dimensions  SMALLINT    NOT NULL DEFAULT 1536,
        vector      TEXT        NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_embeddings_chunk_id ON embeddings (chunk_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_embeddings_tenant_id ON embeddings (tenant_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_embeddings_model ON embeddings (model)
    `);

    // ── Alter vector column to pgvector type and create HNSW index ───────────
    // Only runs if the vector extension was successfully installed above.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE embeddings
          ALTER COLUMN vector TYPE vector(1536)
          USING vector::vector(1536);
        CREATE INDEX idx_embeddings_hnsw
          ON embeddings USING hnsw (vector vector_cosine_ops)
          WITH (m = 16, ef_construction = 64);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping vector column conversion — pgvector not installed.';
      END $$;
    `);

    // ─── skills (global catalog, NOT tenant-scoped) ──────────────────────────
    await queryRunner.query(`
      CREATE TYPE skill_type_enum AS ENUM ('built_in', 'mcp', 'custom')
    `);
    await queryRunner.query(`
      CREATE TABLE skills (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name              VARCHAR(100) NOT NULL UNIQUE,
        display_name      VARCHAR(255) NOT NULL,
        description       TEXT         NOT NULL,
        type              skill_type_enum NOT NULL,
        parameters_schema JSONB        NOT NULL,
        output_schema     JSONB,
        category          VARCHAR(50)  NOT NULL DEFAULT 'general',
        min_plan          VARCHAR(20),
        is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
        handler_class     VARCHAR(100),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_skills_name ON skills (name)`);
    await queryRunner.query(`CREATE INDEX idx_skills_type ON skills (type)`);
    await queryRunner.query(`CREATE INDEX idx_skills_is_active ON skills (is_active)`);

    // ─── tenant_skills ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE tenant_skills (
        id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        skill_id    UUID  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        config      JSONB   NOT NULL DEFAULT '{}',
        priority    INT     NOT NULL DEFAULT 100,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_tenant_skills_tenant_skill ON tenant_skills (tenant_id, skill_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tenant_skills_tenant_enabled ON tenant_skills (tenant_id, is_enabled)
    `);

    // ─── tools ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE tool_type_enum AS ENUM ('http', 'function', 'mcp')
    `);
    await queryRunner.query(`
      CREATE TABLE tools (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name             VARCHAR(100) NOT NULL,
        display_name     VARCHAR(255) NOT NULL,
        description      TEXT,
        type             tool_type_enum NOT NULL,
        config           JSONB        NOT NULL DEFAULT '{}',
        input_schema     JSONB,
        mcp_provider_id  UUID,
        is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_tools_tenant_type ON tools (tenant_id, type)`);
    await queryRunner.query(`CREATE INDEX idx_tools_tenant_active ON tools (tenant_id, is_active)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_tools_tenant_name ON tools (tenant_id, name)
    `);

    // ─── mcp_providers ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE mcp_providers (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name            VARCHAR(255) NOT NULL,
        endpoint        VARCHAR(2048) NOT NULL,
        auth_config     JSONB,
        tool_schemas    JSONB        NOT NULL DEFAULT '[]',
        status          mcp_provider_status_enum NOT NULL DEFAULT 'active',
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        last_error      TEXT,
        last_synced_at  TIMESTAMPTZ,
        rate_limit_rpm  INT          NOT NULL DEFAULT 60,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_mcp_providers_tenant_status   ON mcp_providers (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_mcp_providers_tenant_active   ON mcp_providers (tenant_id, is_active)
    `);

    // ─── mcp_servers ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE mcp_servers (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name            VARCHAR(255) NOT NULL,
        endpoint        VARCHAR(2048) NOT NULL,
        auth_config     JSONB,
        tool_schemas    JSONB        NOT NULL DEFAULT '[]',
        status          mcp_provider_status_enum NOT NULL DEFAULT 'active',
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        last_error      TEXT,
        last_synced_at  TIMESTAMPTZ,
        rate_limit_rpm  INT          NOT NULL DEFAULT 60,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_mcp_servers_tenant_status ON mcp_servers (tenant_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_mcp_servers_tenant_active ON mcp_servers (tenant_id, is_active)
    `);

    // ─── workflows ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE workflows (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        trigger     workflow_trigger_enum NOT NULL,
        steps       JSONB        NOT NULL DEFAULT '[]',
        is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflows_tenant_trigger_active
        ON workflows (tenant_id, trigger, is_active)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflows_tenant_created
        ON workflows (tenant_id, created_at)
    `);

    // ─── workflow_executions ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE workflow_executions (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        workflow_id   UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        lead_id       UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        status        VARCHAR(20) NOT NULL DEFAULT 'running',
        current_step  SMALLINT    NOT NULL DEFAULT 0,
        logs          JSONB       NOT NULL DEFAULT '[]',
        started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at  TIMESTAMPTZ,
        error_message TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_executions_tenant_workflow
        ON workflow_executions (tenant_id, workflow_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_executions_tenant_lead
        ON workflow_executions (tenant_id, lead_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_executions_tenant_status
        ON workflow_executions (tenant_id, status)
    `);

    // ─── workflow_jobs ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE workflow_jobs (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type            workflow_job_type_enum   NOT NULL,
        status          workflow_job_status_enum NOT NULL DEFAULT 'pending',
        reference_id    UUID        NOT NULL,
        reference_type  VARCHAR(50) NOT NULL,
        payload         JSONB       NOT NULL,
        bullmq_job_id   VARCHAR(255),
        queue_name      VARCHAR(100) NOT NULL,
        result          JSONB,
        error_message   TEXT,
        attempt_count   SMALLINT    NOT NULL DEFAULT 0,
        max_attempts    SMALLINT    NOT NULL DEFAULT 3,
        scheduled_at    TIMESTAMPTZ,
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_jobs_tenant_type_status
        ON workflow_jobs (tenant_id, type, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_jobs_tenant_status_scheduled
        ON workflow_jobs (tenant_id, status, scheduled_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_jobs_tenant_reference
        ON workflow_jobs (tenant_id, reference_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workflow_jobs_bullmq_job_id
        ON workflow_jobs (bullmq_job_id)
    `);

    // ─── analytics_daily_snapshots ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE analytics_daily_snapshots (
        id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        date         DATE  NOT NULL,
        metrics      JSONB NOT NULL,
        computed_at  TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_analytics_snapshots_tenant_date
        ON analytics_daily_snapshots (tenant_id, date)
    `);

    // ─── audit_logs ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID,
        actor_user_id UUID,
        actor_type    VARCHAR(50)  NOT NULL DEFAULT 'user',
        action        audit_action_enum      NOT NULL,
        entity_type   audit_entity_type_enum NOT NULL,
        entity_id     UUID         NOT NULL,
        description   TEXT         NOT NULL,
        changes       JSONB,
        context       JSONB,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_tenant_created
        ON audit_logs (tenant_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_tenant_entity
        ON audit_logs (tenant_id, entity_type, entity_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_tenant_actor_created
        ON audit_logs (tenant_id, actor_user_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_action ON audit_logs (action)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_logs_tenant_id ON audit_logs (tenant_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse FK-dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_daily_snapshots CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS workflow_jobs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS workflow_executions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS workflows CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS mcp_servers CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS mcp_providers CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tools CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_skills CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS skills CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tool_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS skill_type_enum CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS embeddings CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS knowledge_chunks CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS knowledge_documents CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS meetings CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS lead_activities CASCADE`);
    await queryRunner.query(`
      ALTER TABLE conversations DROP CONSTRAINT IF EXISTS fk_conversations_lead
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS leads CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS conversation_messages CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_states CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_sessions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS conversations CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS agents CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_configs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_integrations CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_members CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS users CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenants CASCADE`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS audit_entity_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS audit_action_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS workflow_job_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS workflow_job_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS workflow_trigger_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS mcp_provider_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS document_source_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS document_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS meeting_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS meeting_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS lead_activity_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS lead_source_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS lead_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS message_role_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS conversation_stage_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS conversation_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS agent_session_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS agent_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS integration_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS integration_type_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tenant_member_status_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tenant_member_role_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tenant_plan_enum CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_status_enum CASCADE`);
  }
}
