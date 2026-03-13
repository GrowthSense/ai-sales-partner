import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  MaxLength,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentStatus } from '../../common/enums';
import { LlmConfigDto, RagConfigDto } from './create-agent.dto';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;

  @IsOptional()
  @IsString()
  persona?: string;

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
  stageConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  templateVars?: Record<string, string>;
}

export class SetSkillsDto {
  @IsArray()
  @IsString({ each: true })
  skills: string[];
}
