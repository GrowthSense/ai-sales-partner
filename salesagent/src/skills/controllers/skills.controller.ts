import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TenantSkillsService } from '../services/tenant-skills.service';
import { SkillRegistryService } from '../services/skill-registry.service';
import { TenantSkill } from '../entities/tenant-skill.entity';
import { IsObject, IsOptional } from 'class-validator';

class ConfigureSkillDto {
  @IsObject()
  config: Record<string, unknown>;
}

/**
 * SkillsController
 *
 * Tenant-level skill catalogue management.
 * Separate from per-agent skill enable/disable (AgentsController).
 *
 * Endpoints:
 *   GET    /skills                       — list all skills with tenant status
 *   GET    /skills/registry              — list all registered (in-memory) skills
 *   POST   /skills/:skillId/enable       — enable skill for tenant
 *   POST   /skills/:skillId/disable      — disable skill for tenant
 *   PATCH  /skills/:skillId/config       — set per-tenant skill config overrides
 */
@UseGuards(JwtAuthGuard)
@Controller('skills')
export class SkillsController {
  constructor(
    private readonly tenantSkills: TenantSkillsService,
    private readonly registry: SkillRegistryService,
  ) {}

  /**
   * GET /skills
   * Returns all globally active skills with their enabled/config status for this tenant.
   */
  @Get()
  async list(@TenantId() tenantId: string) {
    return this.tenantSkills.listWithStatus(tenantId);
  }

  /**
   * GET /skills/registry
   * Returns skill names currently loaded in the in-process registry.
   * Includes built-in skills and any dynamically registered MCP tools.
   */
  @Get('registry')
  listRegistry(): { name: string; description: string }[] {
    return this.registry.getAll().map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * POST /skills/:skillId/enable
   * Enable a skill for this tenant. Must call this before adding the skill
   * to an agent's enabledSkills.
   */
  @Post(':skillId/enable')
  async enable(
    @TenantId() tenantId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ): Promise<TenantSkill> {
    return this.tenantSkills.enable(tenantId, skillId);
  }

  /**
   * POST /skills/:skillId/disable
   * Disable a skill at the tenant level. Does NOT remove it from existing
   * agents' enabledSkills — those remain but the skill won't execute.
   */
  @Post(':skillId/disable')
  async disable(
    @TenantId() tenantId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ): Promise<TenantSkill> {
    return this.tenantSkills.disable(tenantId, skillId);
  }

  /**
   * PATCH /skills/:skillId/config
   * Update per-tenant config overrides (merged, not replaced).
   * e.g. ScheduleDemo: { calendlyEventTypeId: 'abc123' }
   */
  @Patch(':skillId/config')
  async configure(
    @TenantId() tenantId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Body() dto: ConfigureSkillDto,
  ): Promise<TenantSkill> {
    return this.tenantSkills.configure(tenantId, skillId, dto.config);
  }
}
