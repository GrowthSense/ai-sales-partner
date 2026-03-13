import {
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsString,
  IsEmail,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadStatus } from '../../common/enums';

export class ListLeadsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  agentId?: string;
}
