import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { VisitorClientData } from '../interfaces/ws-client-data.interface';

/**
 * WsWidgetGuard
 *
 * Validates the widget visitor JWT for WebSocket connections to /chat.
 * Visitor tokens are issued by POST /auth/widget/session using the widgetKey.
 *
 * Token is extracted from:
 *   1. client.handshake.auth.token (preferred, set by the JS widget)
 *   2. ?token= query param (fallback for older SDK versions)
 *
 * On success, attaches { visitorId, tenantId, widgetKey } to client.data.
 * Used in handleConnection() of ConversationsGateway.
 */
@Injectable()
export class WsWidgetGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      throw new UnauthorizedException('Missing widget session token');
    }

    try {
      const secret = this.config.get<string>('JWT_WIDGET_SECRET');
      const payload = this.jwt.verify(token, { secret }) as {
        sub: string;        // visitorId
        tenantId: string;
        widgetKey: string;
        type: string;
      };

      if (payload.type !== 'visitor') {
        client.disconnect(true);
        throw new UnauthorizedException('Invalid token type');
      }

      (client.data as VisitorClientData) = {
        visitorId: payload.sub,
        tenantId: payload.tenantId,
        widgetKey: payload.widgetKey,
      };

      return true;
    } catch {
      client.disconnect(true);
      throw new UnauthorizedException('Invalid or expired widget token');
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const queryToken = client.handshake.query?.token as string | undefined;
    return queryToken;
  }
}
