import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DashboardGateway } from './gateways/dashboard.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsWidgetGuard } from './guards/ws-widget.guard';
import { WsRoomsService } from './services/ws-rooms.service';

/**
 * WebsocketModule — infrastructure-only WS concerns.
 *
 * Deliberately has NO dependency on ConversationsModule or AgentsModule
 * to prevent circular references.
 *
 * Exports:
 *   WsRoomsService   — room-scoped emit helpers (used by ConversationsModule, AgentsModule)
 *   WsJwtGuard       — admin JWT guard (used by DashboardGateway + ConversationsModule)
 *   WsWidgetGuard    — visitor widget JWT guard (used by ConversationsGateway)
 *
 * DashboardGateway lives here because it only needs WsRoomsService.
 * ConversationsGateway lives in ConversationsModule because it needs
 * ConversationsService, MessagesService, and AgentOrchestratorService.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '1h') },
      }),
    }),
  ],
  providers: [
    WsRoomsService,
    WsJwtGuard,
    WsWidgetGuard,
    DashboardGateway,
  ],
  exports: [WsRoomsService, WsJwtGuard, WsWidgetGuard, JwtModule],
})
export class WebsocketModule {}
