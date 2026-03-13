import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { McpRegistryService } from '../services/mcp-registry.service';
import { McpProxyService } from '../services/mcp-proxy.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpServer } from '../entities/mcp-server.entity';
import { CreateMcpServerDto, UpdateMcpServerDto } from '../dtos/create-mcp-server.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { EncryptionService } from '../../common/services/encryption.service';

/**
 * McpController — REST API for MCP server management.
 *
 * All endpoints are tenant-scoped: the tenantId is resolved from the
 * authenticated user's JWT, never from the request body.
 *
 * Endpoints:
 *   GET    /mcp/servers          — list registered MCP servers
 *   POST   /mcp/servers          — register a new MCP server
 *   GET    /mcp/servers/:id      — get server details + tool schemas
 *   PATCH  /mcp/servers/:id      — update endpoint / auth config
 *   DELETE /mcp/servers/:id      — remove server + deregister tools
 *   POST   /mcp/servers/:id/sync — manually trigger schema re-sync
 */
@UseGuards(JwtAuthGuard)
@Controller('mcp/servers')
export class McpController {
  constructor(
    private readonly mcpRegistry: McpRegistryService,
    private readonly mcpProxy: McpProxyService,
    private readonly encryption: EncryptionService,

    @InjectRepository(McpServer)
    private readonly serverRepo: Repository<McpServer>,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  @Get()
  async list(@TenantId() tenantId: string): Promise<McpServer[]> {
    return this.serverRepo.find({
      where: { tenantId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateMcpServerDto,
  ): Promise<McpServer> {
    return this.mcpRegistry.registerServer(
      tenantId,
      dto.name,
      dto.endpoint,
      dto.authConfig,
      dto.rateLimitRpm,
    );
  }

  // ─── Get ──────────────────────────────────────────────────────────────────

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<McpServer> {
    return this.serverRepo.findOneOrFail({ where: { id, tenantId } });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMcpServerDto,
  ): Promise<McpServer> {
    const server = await this.serverRepo.findOneOrFail({ where: { id, tenantId } });

    if (dto.name !== undefined) server.name = dto.name;
    if (dto.endpoint !== undefined) server.endpoint = dto.endpoint;
    if (dto.rateLimitRpm !== undefined) server.rateLimitRpm = dto.rateLimitRpm;

    if (dto.authConfig) {
      const { authType, ...secrets } = dto.authConfig;
      server.authConfig = {
        ...this.encryption.encryptJson({ authType, ...secrets }),
        authType,
      };
    }

    const saved = await this.serverRepo.save(server);

    // Re-sync tools if endpoint changed
    if (dto.endpoint || dto.authConfig) {
      await this.mcpRegistry.syncTools(id, tenantId);
    }

    return saved;
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.serverRepo.findOneOrFail({ where: { id, tenantId } });
    await this.mcpRegistry.deregisterServer(id);
    await this.serverRepo.delete(id);
  }

  // ─── Manual sync ──────────────────────────────────────────────────────────

  @Post(':id/sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sync(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.serverRepo.findOneOrFail({ where: { id, tenantId } });
    await this.mcpRegistry.syncTools(id, tenantId);
  }
}
