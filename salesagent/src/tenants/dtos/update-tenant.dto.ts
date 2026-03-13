import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantPlan } from '../../common/enums';
import { TenantSettingsDto } from './create-tenant.dto';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenantSettingsDto)
  settings?: TenantSettingsDto;
}
