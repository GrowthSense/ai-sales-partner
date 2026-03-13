import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Skill } from './entities/skill.entity';
import { TenantSkill } from './entities/tenant-skill.entity';

import { SkillRegistryService } from './services/skill-registry.service';
import { SkillExecutorService } from './services/skill-executor.service';
import { TenantSkillsService } from './services/tenant-skills.service';
import { SkillsController } from './controllers/skills.controller';

/**
 * SkillsModule
 *
 * Manages the global skill catalogue and per-tenant skill activation.
 *
 * Internal services (used by AgentsModule for the reasoning loop):
 *   SkillRegistryService  — in-memory registry of all ISkill instances
 *   SkillExecutorService  — safe execution with timeout + audit hook
 *
 * Admin API (tenant-facing):
 *   GET    /skills              — list all skills with tenant enabled/config status
 *   GET    /skills/registry     — list in-process registered skill names
 *   POST   /skills/:id/enable   — enable skill for tenant
 *   POST   /skills/:id/disable  — disable skill for tenant
 *   PATCH  /skills/:id/config   — update per-tenant skill config
 */
@Module({
  imports: [TypeOrmModule.forFeature([Skill, TenantSkill])],
  controllers: [SkillsController],
  providers: [
    SkillRegistryService,
    SkillExecutorService,
    TenantSkillsService,
  ],
  exports: [SkillRegistryService, SkillExecutorService, TenantSkillsService],
})
export class SkillsModule {}
