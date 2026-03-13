import {
  IsEnum,
  IsOptional,
  IsObject,
  IsString,
  IsNumber,
  IsBoolean,
  IsPort,
  ValidateNested,
  IsUrl,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationType } from '../../common/enums';

// ─── Credential shapes (one per integration type) ────────────────────────────

export class HubspotCredentialsDto {
  @IsString()
  accessToken: string;
}

export class SalesforceCredentialsDto {
  @IsString()
  instanceUrl: string;

  @IsString()
  accessToken: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;
}

export class CalendlyCredentialsDto {
  @IsString()
  apiKey: string;
}

export class CalcomCredentialsDto {
  @IsString()
  apiKey: string;
}

export class SmtpCredentialsDto {
  @IsString()
  host: string;

  @IsNumber()
  port: number;

  @IsString()
  user: string;

  @IsString()
  password: string;

  @IsBoolean()
  secure: boolean;
}

export class WebhookCredentialsDto {
  @IsOptional()
  @IsString()
  signingSecret?: string;
}

// ─── Config shapes (non-secret, stored as-is) ────────────────────────────────

export class WebhookConfigDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];  // e.g. ['lead.created', 'lead.qualified']
}

// ─── Main DTO ─────────────────────────────────────────────────────────────────

/**
 * UpsertIntegrationDto
 *
 * Used for both create and update (upsert semantics).
 * Credentials are encrypted before storage — never stored as plaintext.
 * Config is non-sensitive (field mappings, event type IDs, URLs).
 */
export class UpsertIntegrationDto {
  @IsEnum(IntegrationType)
  type: IntegrationType;

  /**
   * Provider-specific credentials.
   * Shape depends on `type` — validated at the service layer.
   * Stored encrypted using AES-256-GCM.
   */
  @IsObject()
  credentials: Record<string, unknown>;

  /**
   * Non-sensitive config (field mappings, webhook URLs, event type IDs).
   * Stored as plain JSONB.
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
