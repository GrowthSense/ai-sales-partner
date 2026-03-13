import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { AgentsService } from '../services/agents.service';
import { Agent } from '../entities/agent.entity';
import { CreateAgentDto } from '../dtos/create-agent.dto';
import { UpdateAgentDto, SetSkillsDto } from '../dtos/update-agent.dto';

/**
 * AgentsController
 *
 * Agent configuration management for tenant admins.
 * All endpoints are tenant-scoped (tenantId from JWT).
 *
 * Endpoints:
 *   GET    /agents                         — list all agents for tenant
 *   POST   /agents                         — create a new agent
 *   GET    /agents/:id                     — agent detail (includes AgentConfig)
 *   PATCH  /agents/:id                     — update persona, skills, llmConfig, etc.
 *   DELETE /agents/:id                     — soft-delete agent
 *   POST   /agents/:id/deploy              — activate agent (status → ACTIVE)
 *
 * Skill management (per-agent):
 *   PUT    /agents/:id/skills              — replace the full enabledSkills list
 *   POST   /agents/:id/skills/:skillName   — enable a single skill
 *   DELETE /agents/:id/skills/:skillName   — disable a single skill
 */
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  @Get()
  async list(@TenantId() tenantId: string): Promise<Agent[]> {
    return this.agents.findByTenant(tenantId);
  }

  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateAgentDto,
  ): Promise<Agent> {
    return this.agents.create(dto, tenantId);
  }

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Agent> {
    return this.agents.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<Agent> {
    return this.agents.update(id, dto, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.agents.delete(id, tenantId);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * POST /agents/:id/deploy
   *
   * Sets status = ACTIVE and records deployedAt. Once deployed, the agent
   * is available to visitors via the widget. Requires the agent to have
   * a configuration (persona must be set).
   */
  @Post(':id/deploy')
  async deploy(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Agent> {
    return this.agents.deploy(id, tenantId);
  }

  // ─── Skill management ─────────────────────────────────────────────────────

  /**
   * PUT /agents/:id/skills
   * Replace the full enabled skills list.
   * Body: { skills: ['AnswerQuestion', 'CaptureContact', ...] }
   */
  @Post(':id/skills')
  async setSkills(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSkillsDto,
  ): Promise<Agent> {
    return this.agents.setSkills(id, dto.skills, tenantId);
  }

  /**
   * POST /agents/:id/skills/:skillName
   * Enable a single skill for this agent.
   */
  @Post(':id/skills/:skillName')
  async enableSkill(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skillName') skillName: string,
  ): Promise<Agent> {
    return this.agents.enableSkill(id, skillName, tenantId);
  }

  /**
   * DELETE /agents/:id/skills/:skillName
   * Disable a single skill for this agent.
   */
  @Delete(':id/skills/:skillName')
  @HttpCode(HttpStatus.OK)
  async disableSkill(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skillName') skillName: string,
  ): Promise<Agent> {
    return this.agents.disableSkill(id, skillName, tenantId);
  }
}
