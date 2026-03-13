export class TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  /** Access token TTL in seconds (matches JWT_ACCESS_EXPIRES_IN). */
  expiresIn: number;
  tokenType: 'Bearer';
}
