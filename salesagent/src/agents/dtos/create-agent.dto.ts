import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationStage } from '../../common/enums';

export class LlmConfigDto {
  @IsOptional()
  @IsString()
  model?: string;      // default: 'gpt-4o'

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(256)
  @Max(16384)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  streaming?: boolean;
}

export class RagConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  topK?: number;

  @IsOptional()
  @IsBoolean()
  rerankEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(2000)
  rerankTimeoutMs?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridSearchWeight?: number;
}

export class StageInstructionDto {
  @IsString()
  @IsNotEmpty()
  instructions: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredSkills?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTurns?: number;

  @IsOptional()
  @IsEnum(ConversationStage)
  autoAdvanceTo?: ConversationStage;
}

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsNotEmpty()
  persona: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fallbackMessage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledSkills?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LlmConfigDto)
  llmConfig?: LlmConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RagConfigDto)
  ragConfig?: RagConfigDto;

  @IsOptional()
  @IsObject()
  stageConfig?: Record<string, StageInstructionDto>;

  @IsOptional()
  @IsObject()
  templateVars?: Record<string, string>;
}
