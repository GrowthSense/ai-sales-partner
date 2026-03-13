import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { ServerEvents } from '../interfaces/ws-events.enum';

export interface ToolStartedPayload {
  toolCallId: string;
  toolName: string;
  /** Human-readable label shown in the widget (e.g. "Checking calendar…") */
  label?: string;
}

export interface ToolFinishedPayload {
  toolCallId: string;
  toolName: string;
  success: boolean;
  durationMs: number;
}

export interface StateUpdatedPayload {
  stage: string;
  leadId: string | null;
  leadScore?: number | null;
  leadStatus?: string | null;
  iterationCount: number;
}

/**
 * WsRoomsService
 *
 * Centralises all WebSocket room emit logic.
 * Injected into gateways and the AgentOrchestratorService so that
 * any service can emit WS events without holding a reference to the Server.
 *
 * Room naming conventions:
 *   visitor chat:    'conversation:<id>'
 *   dashboard:       'tenant:<id>'
 *   lead updates:    'tenant:<id>:leads'
 *   handoff alerts:  'tenant:<id>:handoffs'
 *
 * The server reference is set once the gateway initialises via setServer().
 */
@Injectable()
export class WsRoomsService {
  private chatServer: Server | null = null;
  private dashboardServer: Server | null = null;

  /**
   * Called by ConversationsGateway.afterInit() to register the /chat server.
   */
  setChatServer(server: Server): void {
    this.chatServer = server;
  }

  /**
   * Called by DashboardGateway.afterInit() to register the /dashboard server.
   */
  setDashboardServer(server: Server): void {
    this.dashboardServer = server;
  }

  getChatServer(): Server | null {
    return this.chatServer;
  }

  // ─── Chat room helpers ────────────────────────────────────────────────────

  emitToConversation(conversationId: string, event: string, data: unknown): void {
    this.chatServer?.to(`conversation:${conversationId}`).emit(event, data);
  }

  /**
   * Emitted right before a skill/tool begins executing.
   * Lets the visitor widget show "Checking calendar…" or similar progress.
   */
  emitToolStarted(conversationId: string, payload: ToolStartedPayload): void {
    this.chatServer
      ?.to(`conversation:${conversationId}`)
      .emit(ServerEvents.TOOL_EXECUTION_STARTED, payload);
  }

  /**
   * Emitted after a skill/tool completes (success or failure).
   */
  emitToolFinished(conversationId: string, payload: ToolFinishedPayload): void {
    this.chatServer
      ?.to(`conversation:${conversationId}`)
      .emit(ServerEvents.TOOL_EXECUTION_FINISHED, payload);
  }

  /**
   * Emitted after any meaningful state mutation (stage change, lead update).
   * Provides a holistic snapshot so the widget can update all state from a
   * single event rather than juggling stage.changed + lead.captured separately.
   */
  emitStateUpdated(conversationId: string, payload: StateUpdatedPayload): void {
    this.chatServer
      ?.to(`conversation:${conversationId}`)
      .emit(ServerEvents.STATE_UPDATED, payload);
  }

  /**
   * Emitted to the visitor room when a human handoff is triggered.
   * The widget uses this to show a "You'll be connected to a human" message.
   */
  emitHandoffTriggered(conversationId: string): void {
    this.chatServer
      ?.to(`conversation:${conversationId}`)
      .emit(ServerEvents.HANDOFF_TRIGGERED, { conversationId });
  }

  // ─── Dashboard room helpers ───────────────────────────────────────────────

  emitToTenant(tenantId: string, event: string, data: unknown): void {
    this.dashboardServer?.to(`tenant:${tenantId}`).emit(event, data);
  }

  emitToTenantLeads(tenantId: string, data: unknown): void {
    this.dashboardServer
      ?.to(`tenant:${tenantId}:leads`)
      .emit(ServerEvents.LEAD_NEW, data);
  }

  emitToTenantHandoffs(tenantId: string, data: unknown): void {
    this.dashboardServer
      ?.to(`tenant:${tenantId}:handoffs`)
      .emit(ServerEvents.HANDOFF_REQUESTED, data);
  }

  /**
   * Emitted when a NEGATIVE or CRITICAL social media comment is detected.
   * Delivered to the tenant's social-alerts dashboard room.
   */
  emitNegativeComment(tenantId: string, data: unknown): void {
    this.dashboardServer
      ?.to(`tenant:${tenantId}:social-alerts`)
      .emit(ServerEvents.NEGATIVE_COMMENT, data);
  }
}
