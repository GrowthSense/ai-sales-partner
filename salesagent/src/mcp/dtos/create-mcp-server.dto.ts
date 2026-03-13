import {
  IsString,
  IsUrl,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class McpAuthConfigDto {
  @IsIn(['bearer', 'api-key', 'basic', 'none'])
  authType: 'bearer' | 'api-key' | 'basic' | 'none';

  /**
   * Secret token / API key / password.
   * Stored encrypted — never returned in API responses.
   */
  @IsOptional()
  @IsString()
  token?: string;

  /** For 'basic' auth: the username. */
  @IsOptional()
  @IsString()
  username?: string;
}

export class CreateMcpServerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUrl({ require_tld: false }) // allow localhost for dev MCP servers
  endpoint: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => McpAuthConfigDto)
  authConfig?: McpAuthConfigDto;

  /** Calls per minute cap. Defaults to 60. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  rateLimitRpm?: number;
}

export class UpdateMcpServerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  endpoint?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => McpAuthConfigDto)
  authConfig?: McpAuthConfigDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  rateLimitRpm?: number;
}
