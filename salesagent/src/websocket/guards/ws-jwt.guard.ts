import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { AdminClientData } from '../interfaces/ws-client-data.interface';

/**
 * WsJwtGuard
 *
 * Validates the standard admin JWT for WebSocket connections to /dashboard.
 * Extracts the token from:
 *   1. client.handshake.auth.token (preferred)
 *   2. Authorization header (Bearer <token>)
 *
 * On success, attaches { userId, tenantId, role } to client.data.
 * Used in handleConnection() of DashboardGateway.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      const secret = this.config.get<string>('JWT_SECRET');
      const payload = this.jwt.verify(token, { secret }) as {
        sub: string;
        tenantId: string;
        role: string;
      };

      (client.data as AdminClientData) = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
      };

      return true;
    } catch {
      client.disconnect(true);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const authHeader = client.handshake.headers?.authorization as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return undefined;
  }
}
