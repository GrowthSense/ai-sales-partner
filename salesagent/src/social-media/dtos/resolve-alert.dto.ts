import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
