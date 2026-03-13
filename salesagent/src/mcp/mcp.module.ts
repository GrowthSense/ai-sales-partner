import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { McpServer } from './entities/mcp-server.entity';
import { MCPProvider } from './entities/mcp-provider.entity';
import { McpProxyService } from './services/mcp-proxy.service';
import { McpRegistryService } from './services/mcp-registry.service';
import { McpController } from './controllers/mcp.controller';

import { SkillsModule } from '../skills/skills.module';
import { CommonModule } from '../common/common.module';

/**
 * McpModule
 *
 * Manages Model Context Protocol server registration, tool schema sync,
 * and server-side call proxying.
 *
 * Exports McpRegistryService for use by AgentsModule (to include MCP tools
 * in the agent's skill set) and McpProxyService for direct call routing.
 *
 * Depends on:
 *  - SkillsModule   → registers MCP tools as ISkill instances
 *  - CommonModule   → provides EncryptionService (AES-256-GCM)
 *  - ScheduleModule → daily sync cron
 *  - Redis          → rate limiting in McpProxyService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([McpServer, MCPProvider]),
    SkillsModule,
    CommonModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [McpController],
  providers: [McpProxyService, McpRegistryService],
  exports: [McpRegistryService, McpProxyService],
})
export class McpModule {}
