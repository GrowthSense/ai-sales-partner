import {
  IsString,
  IsOptional,
  IsEnum,
  IsEmail,
  IsArray,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantPlan } from '../../common/enums';

export class TenantBrandingDto {
  @IsString()
  @MaxLength(7)
  primaryColor: string = '#4F46E5';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;

  @IsString()
  @MaxLength(100)
  agentName: string = 'Assistant';

  @IsString()
  @MaxLength(500)
  greetingMessage: string = 'Hi! How can I help you today?';
}

export class TenantSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TenantBrandingDto)
  branding?: TenantBrandingDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  conversationRetentionDays?: number;

  @IsOptional()
  @IsEmail()
  leadNotificationEmail?: string;
}

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenantSettingsDto)
  settings?: TenantSettingsDto;
}
