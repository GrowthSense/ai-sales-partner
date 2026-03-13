import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '../entities/conversation-message.entity';
import { MessageRole } from '../../common/enums';
import { LlmToolCall } from '../../llm/dto/llm.dto';

export interface CreateMessageDto {
  tenantId: string;
  conversationId: string;
  role: MessageRole;
  content: string | null;
  toolCalls?: LlmToolCall[] | null;
  toolCallId?: string | null;
  toolName?: string | null;
  tokenCount?: number;
  sessionId?: string | null;
}

/**
 * MessagesService
 *
 * Append-only message store — messages are never updated after creation.
 * The hot read path is getHistory(), called before every agent turn.
 */
@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(ConversationMessage)
    private readonly repo: Repository<ConversationMessage>,
  ) {}

  async create(dto: CreateMessageDto): Promise<ConversationMessage> {
    const msg = this.repo.create({
      tenantId: dto.tenantId,
      conversationId: dto.conversationId,
      role: dto.role,
      content: dto.content,
      toolCalls: dto.toolCalls ?? null,
      toolCallId: dto.toolCallId ?? null,
      toolName: dto.toolName ?? null,
      tokenCount: dto.tokenCount ?? 0,
      sessionId: dto.sessionId ?? null,
    });
    return this.repo.save(msg);
  }

  /**
   * Bulk-insert multiple messages in one DB round-trip.
   * Used by the orchestrator to persist user + assistant + tool messages together.
   */
  async createMany(dtos: CreateMessageDto[]): Promise<ConversationMessage[]> {
    const entities = dtos.map((dto) =>
      this.repo.create({
        tenantId: dto.tenantId,
        conversationId: dto.conversationId,
        role: dto.role,
        content: dto.content,
        toolCalls: dto.toolCalls ?? null,
        toolCallId: dto.toolCallId ?? null,
        toolName: dto.toolName ?? null,
        tokenCount: dto.tokenCount ?? 0,
        sessionId: dto.sessionId ?? null,
      }),
    );
    return this.repo.save(entities);
  }

  /**
   * Load conversation history ordered oldest → newest.
   * This is the shape the MemoryManagerService expects for trimming + assembly.
   */
  async getHistory(conversationId: string, tenantId: string): Promise<ConversationMessage[]> {
    return this.repo.find({
      where: { conversationId, tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  async findByConversation(
    conversationId: string,
    tenantId: string,
    pagination: { page: number; limit: number },
  ): Promise<[ConversationMessage[], number]> {
    return this.repo.findAndCount({
      where: { conversationId, tenantId },
      order: { createdAt: 'ASC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
  }
}
