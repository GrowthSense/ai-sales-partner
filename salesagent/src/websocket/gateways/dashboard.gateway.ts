import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { WsJwtGuard } from '../guards/ws-jwt.guard';
import { WsRoomsService } from '../services/ws-rooms.service';
import { AdminClientData } from '../interfaces/ws-client-data.interface';

/**
 * DashboardGateway
 *
 * Socket.io gateway for the /dashboard namespace.
 * Used by the tenant admin SPA to receive real-time events.
 *
 * Authentication: WsJwtGuard validates a standard admin JWT on connection.
 * No inbound events — all communication is server → client.
 *
 * Room model (admin subscribes to all three):
 *   'tenant:<id>'           — general tenant events
 *   'tenant:<id>:leads'     — new lead notifications
 *   'tenant:<id>:handoffs'  — human handoff alerts
 *
 * Events emitted (server → client):
 *   lead.new           — new lead captured during a conversation
 *   handoff.requested  — HandoffToHuman skill fired
 *   conversation.live  — active conversation started (optional live view)
 */
@WebSocketGateway({ namespace: '/dashboard', cors: { origin: '*' } })
export class DashboardGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(private readonly rooms: WsRoomsService) {}

  afterInit(server: Server): void {
    this.rooms.setDashboardServer(server);
    this.logger.log('Dashboard gateway initialised');
  }

  @UseGuards(WsJwtGuard)
  handleConnection(client: Socket): void {
    const { tenantId, userId } = client.data as AdminClientData;

    // Join all tenant rooms
    client.join(`tenant:${tenantId}`);
    client.join(`tenant:${tenantId}:leads`);
    client.join(`tenant:${tenantId}:handoffs`);
    client.join(`tenant:${tenantId}:social-alerts`);

    this.logger.debug(
      `Admin connected: userId=${userId} tenantId=${tenantId} socketId=${client.id}`,
    );
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<AdminClientData>;
    this.logger.debug(
      `Admin disconnected: userId=${data.userId ?? 'unknown'} socketId=${client.id}`,
    );
  }
}
