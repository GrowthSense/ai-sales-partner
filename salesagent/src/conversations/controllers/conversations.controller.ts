import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ParseEnumPipe,
  Optional,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ConversationsService } from '../services/conversations.service';
import { MessagesService } from '../services/messages.service';
import { Conversation } from '../entities/conversation.entity';
import { ConversationMessage } from '../entities/conversation-message.entity';
import { AgentState } from '../../agents/entities/agent-state.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { ConversationStatus, ConversationStage } from '../../common/enums';

/**
 * ConversationsController
 *
 * REST API for the tenant admin dashboard to inspect and manage conversations.
 * All endpoints are tenant-scoped (tenantId from JWT).
 *
 * Note: Conversation *creation* and *message sending* happen over WebSocket
 * (ConversationsGateway). These endpoints are read/admin-only.
 *
 * Endpoints:
 *   GET    /conversations                      — list with filters + pagination
 *   GET    /conversations/:id                  — conversation detail
 *   GET    /conversations/:id/messages         — paginated message history
 *   PATCH  /conversations/:id                  — admin update (close, annotate)
 *   GET    /conversations/:id/session-state    — live agent state (debug)
 *   GET    /conversations/:id/lead             — lead summary for this conversation
 */
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('stage') stage?: string,
    @Query('agentId') agentId?: string,
    @Query('visitorId') visitorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ items: Conversation[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.conversations.findAll(
      tenantId,
      {
        ...(status ? { status: status as ConversationStatus } : {}),
        ...(stage ? { stage: stage as ConversationStage } : {}),
        ...(agentId ? { agentId } : {}),
        ...(visitorId ? { visitorId } : {}),
        ...(from ? { from: new Date(from) } : {}),
        ...(to ? { to: new Date(to) } : {}),
      },
      { page, limit },
    );

    return { items, total, page, limit };
  }

  // ─── Get ──────────────────────────────────────────────────────────────────

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Conversation> {
    return this.conversations.findById(id, tenantId);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  @Get(':id/messages')
  async getMessages(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{ items: ConversationMessage[]; total: number; page: number; limit: number }> {
    // Ownership check — throws NotFoundException if wrong tenant
    await this.conversations.findById(id, tenantId);

    const [items, total] = await this.messages.findByConversation(id, tenantId, { page, limit });
    return { items, total, page, limit };
  }

  // ─── Patch (admin) ────────────────────────────────────────────────────────

  @Patch(':id')
  async patch(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status?: string,
  ): Promise<Conversation> {
    return this.conversations.patch(id, tenantId, {
      ...(status ? { status: status as ConversationStatus } : {}),
    });
  }

  // ─── Session state (debug / human handoff context) ────────────────────────

  /**
   * GET /conversations/:id/session-state
   *
   * Returns the current AgentState for this conversation — the live snapshot
   * of what the agent retrieved, what stage it's in, and whether it's processing.
   * Useful for debugging stuck conversations and human handoff context panels.
   */
  @Get(':id/session-state')
  async getSessionState(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentState | null> {
    return this.conversations.getSessionState(id, tenantId);
  }

  // ─── Lead summary ─────────────────────────────────────────────────────────

  /**
   * GET /conversations/:id/lead
   *
   * Returns the Lead record captured during this conversation, if any.
   * Null until the CaptureContact skill has fired.
   * Includes BANT qualification data and contact info collected so far.
   */
  @Get(':id/lead')
  async getLeadSummary(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Lead | null> {
    return this.conversations.getLeadSummary(id, tenantId);
  }
}
