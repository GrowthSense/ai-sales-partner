import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { WidgetJwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * WidgetJwtStrategy — Passport strategy for visitor widget sessions.
 *
 * Named 'widget-jwt' to distinguish from the admin 'jwt' strategy.
 * Used exclusively by WsWidgetGuard (WebSocket /chat namespace).
 *
 * Signed with JWT_WIDGET_SECRET (separate from JWT_ACCESS_SECRET) to ensure
 * visitor tokens cannot be used on admin routes and vice versa.
 *
 * The validate() return value is attached to client.data in WsWidgetGuard.
 */
@Injectable()
export class WidgetJwtStrategy extends PassportStrategy(Strategy, 'widget-jwt') {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_WIDGET_SECRET'),
    });
  }

  validate(payload: WidgetJwtPayload): { visitorId: string; tenantId: string; widgetKey: string } {
    if (payload.type !== 'visitor') {
      throw new UnauthorizedException('Invalid widget token type');
    }

    return {
      visitorId: payload.sub,
      tenantId: payload.tenantId,
      widgetKey: payload.widgetKey,
    };
  }
}
