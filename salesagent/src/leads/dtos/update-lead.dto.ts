import {
  IsOptional,
  IsString,
  IsEmail,
  IsEnum,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadStatus } from '../../common/enums';

export class BantPatchDto {
  @IsOptional()
  @IsString()
  budget?: string;

  @IsOptional()
  budget_confirmed?: boolean;

  @IsOptional()
  @IsString()
  authority?: string;

  @IsOptional()
  is_decision_maker?: boolean;

  @IsOptional()
  @IsString()
  need?: string;

  @IsOptional()
  @IsString()
  timeline?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  jobTitle?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsObject()
  qualificationData?: Partial<{
    budget: string;
    hasBudget: boolean;
    authority: string;
    isDecisionMaker: boolean;
    need: string;
    needStrength: 'low' | 'medium' | 'high';
    timeline: string;
    hasTimeline: boolean;
    notes: string;
  }>;
}
