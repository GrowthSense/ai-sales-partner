import {
  IsUUID,
  IsOptional,
  IsString,
  IsIn,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConversationMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pageTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmCampaign?: string;

  @IsOptional()
  @IsIn(['desktop', 'mobile', 'tablet'])
  deviceType?: 'desktop' | 'mobile' | 'tablet';
}

export class CreateConversationDto {
  @IsUUID()
  agentId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationMetadataDto)
  metadata?: ConversationMetadataDto;
}
