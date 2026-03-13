import { IsEnum, IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { SocialPlatform } from '../../common/enums';

export class ConnectSocialAccountDto {
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  /** Platform-assigned page/user/channel ID. */
  @IsString()
  @IsNotEmpty()
  externalId: string;

  /** Human-readable page name or @handle. */
  @IsString()
  @IsNotEmpty()
  handle: string;

  /** OAuth access token (encrypted before storage). */
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  /**
   * Platform-specific non-secret config.
   * Facebook/Instagram: { pageId: '123' }
   * LinkedIn: { organizationUrn: 'urn:li:organization:456' }
   * Twitter: { twitterUserId: '789' }
   */
  @IsOptional()
  @IsObject()
  platformConfig?: Record<string, unknown>;
}
