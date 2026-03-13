import { IsEmail, IsString, IsUUID, IsOptional, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  /**
   * Required when the user belongs to multiple tenants.
   * If omitted and the user has exactly one active membership,
   * AuthService resolves it automatically.
   */
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
