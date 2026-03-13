import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Ip,
  Headers,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';

import { AuthService } from '../services/auth.service';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoginDto } from '../dtos/login.dto';
import { WidgetSessionDto } from '../dtos/widget-session.dto';
import { User } from '../../users/entities/user.entity';
import { RequestUser } from '../interfaces/jwt-payload.interface';

class RefreshDto {
  refreshToken: string;
}

class LogoutDto {
  refreshToken: string;
}

/**
 * AuthController
 *
 * @Public() routes are exempt from JwtAuthGuard (see public.decorator.ts).
 *
 * POST /auth/login              — email + password → access + refresh tokens
 * POST /auth/refresh            — rotate refresh token
 * POST /auth/logout             — revoke refresh token
 * POST /auth/widget/session     — anonymous visitor token from widget key
 * GET  /auth/me                 — current user from access token (JWT-protected)
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   *
   * LocalAuthGuard runs first: calls AuthService.validateUser(email, password).
   * If credentials are valid, request.user is set to the validated User.
   * We then call AuthService.login() to issue the token pair.
   *
   * @Public() is needed because JwtAuthGuard (global) would reject this route
   * before LocalAuthGuard even runs.
   */
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Request() req: ExpressRequest & { user: User },
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    // dto.tenantId would allow multi-tenant login — not in LoginDto for now.
    // AuthService resolves the primary tenant if not specified.
    return this.authService.login(req.user, undefined, ip, userAgent);
  }

  /**
   * POST /auth/refresh
   *
   * Token rotation: old refresh token → new access + refresh token pair.
   * The old refresh token is revoked on the DB level.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refreshTokens(dto.refreshToken, ip, userAgent);
  }

  /**
   * POST /auth/logout
   *
   * Revokes the refresh token. The access token remains valid until expiry
   * (TTL: 15m) — this is a deliberate trade-off for stateless access tokens.
   * For immediate invalidation, use a Redis blocklist (future enhancement).
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  /**
   * POST /auth/widget/session
   *
   * Issues an anonymous visitor JWT for the embedded widget.
   * No user account required — identifies the visitor by a random UUID.
   * The visitorId is stored in browser localStorage and reused across sessions.
   */
  @Public()
  @Post('widget/session')
  @HttpCode(HttpStatus.CREATED)
  async widgetSession(@Body() dto: WidgetSessionDto) {
    return this.authService.issueWidgetSession(dto.widgetKey, dto.visitorId);
  }

  /**
   * GET /auth/me
   *
   * Returns the current user's identity from their JWT.
   * Protected: requires valid access token.
   * Use this for the admin SPA to show the logged-in user's name/role.
   */
  @Post('me')
  @HttpCode(HttpStatus.OK)
  async me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
