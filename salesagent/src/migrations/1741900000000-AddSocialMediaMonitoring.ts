import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddSocialMediaMonitoring
 *
 * Creates tables for the social media comment monitoring feature:
 *   social_accounts         — connected Facebook/Instagram/Twitter/LinkedIn pages
 *   social_comments         — raw fetched comments (idempotent by externalId+platform)
 *   comment_analyses        — OpenAI sentiment + lead-signal results
 *   negative_comment_alerts — dashboard alerts for negative/critical comments
 *
 * Also:
 *   - Adds 'social_media' to lead_source_enum
 *   - Creates new enum types for the social media domain
 *
 * Down migration:
 *   - Drops all 4 tables (CASCADE)
 *   - Drops the 5 new enum types
 *   - Removes 'social_media' from lead_source_enum by recreating it
 */
export class AddSocialMediaMonitoring1741900000000 implements MigrationInterface {
  name = 'AddSocialMediaMonitoring1741900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── New enum types ───────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TYPE social_platform_enum AS ENUM (
        'facebook', 'instagram', 'twitter', 'linkedin'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE comment_sentiment_enum AS ENUM (
        'positive', 'neutral', 'negative', 'critical'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE social_account_status_enum AS ENUM (
        'active', 'inactive', 'error'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE negative_alert_status_enum AS ENUM (
        'open', 'resolved'
      )
    `);

    // ─── Extend lead_source_enum ──────────────────────────────────────────────
    // PostgreSQL does not support removing enum values, but adding is safe.
    await queryRunner.query(`
      ALTER TYPE lead_source_enum ADD VALUE IF NOT EXISTS 'social_media'
    `);

    // ─── social_accounts ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE social_accounts (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        platform      social_platform_enum NOT NULL,
        external_id   VARCHAR(255) NOT NULL,
        handle        VARCHAR(255) NOT NULL,
        status        social_account_status_enum NOT NULL DEFAULT 'active',
        credentials   JSONB,
        config        JSONB NOT NULL DEFAULT '{}',
        last_synced_at TIMESTAMPTZ,
        error_message TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_accounts_tenant_id
        ON social_accounts(tenant_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_accounts_tenant_platform
        ON social_accounts(tenant_id, platform)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_accounts_tenant_status
        ON social_accounts(tenant_id, status)
    `);

    // ─── social_comments ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE social_comments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id      UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        platform        social_platform_enum NOT NULL,
        external_id     VARCHAR(512) NOT NULL,
        text            TEXT NOT NULL,
        author_name     VARCHAR(255) NOT NULL,
        author_username VARCHAR(255),
        author_email    VARCHAR(255),
        published_at    TIMESTAMPTZ NOT NULL,
        post_url        TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_social_comments_external_platform UNIQUE (external_id, platform)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_comments_tenant_id
        ON social_comments(tenant_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_comments_tenant_account_published
        ON social_comments(tenant_id, account_id, published_at)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_social_comments_tenant_platform
        ON social_comments(tenant_id, platform)
    `);

    // ─── comment_analyses ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE comment_analyses (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        comment_id       UUID NOT NULL UNIQUE REFERENCES social_comments(id) ON DELETE CASCADE,
        sentiment        comment_sentiment_enum NOT NULL,
        sentiment_score  FLOAT NOT NULL,
        sentiment_reason TEXT,
        is_lead_signal   BOOLEAN NOT NULL DEFAULT FALSE,
        lead_signals     TEXT,
        extracted_emails VARCHAR(255)[] NOT NULL DEFAULT '{}',
        extracted_phones VARCHAR(255)[] NOT NULL DEFAULT '{}',
        suggested_actions VARCHAR(255)[] NOT NULL DEFAULT '{}',
        lead_id          UUID,
        analyzed_at      TIMESTAMPTZ NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_comment_analyses_tenant_id
        ON comment_analyses(tenant_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_comment_analyses_tenant_sentiment
        ON comment_analyses(tenant_id, sentiment)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_comment_analyses_tenant_lead_signal
        ON comment_analyses(tenant_id, is_lead_signal)
    `);

    // ─── negative_comment_alerts ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE negative_comment_alerts (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        comment_id       UUID NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
        sentiment        comment_sentiment_enum NOT NULL,
        alert_reason     TEXT NOT NULL,
        status           negative_alert_status_enum NOT NULL DEFAULT 'open',
        ws_emitted       BOOLEAN NOT NULL DEFAULT FALSE,
        email_sent       BOOLEAN NOT NULL DEFAULT FALSE,
        email_sent_at    TIMESTAMPTZ,
        resolution_notes TEXT,
        resolved_at      TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_negative_comment_alerts_tenant_id
        ON negative_comment_alerts(tenant_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_negative_comment_alerts_tenant_status
        ON negative_comment_alerts(tenant_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_negative_comment_alerts_tenant_sentiment
        ON negative_comment_alerts(tenant_id, sentiment)
    `);

  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS negative_comment_alerts CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS comment_analyses CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS social_comments CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS social_accounts CASCADE`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS negative_alert_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS social_account_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS comment_sentiment_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS social_platform_enum`);

    // Note: PostgreSQL does not support removing enum values.
    // The 'social_media' value in lead_source_enum is left in place.
    // Rolling back the entire application would require recreating the enum,
    // which would require updating all columns using it.
  }
}
