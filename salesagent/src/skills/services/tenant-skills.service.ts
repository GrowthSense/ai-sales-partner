import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSkill } from '../entities/tenant-skill.entity';
import { Skill } from '../entities/skill.entity';
import { SkillRegistryService } from './skill-registry.service';

/**
 * TenantSkillsService
 *
 * Manages the TenantSkill join table: which skills are enabled for a tenant
 * and what per-tenant configuration overrides apply.
 *
 * Separate from Agent.enabledSkills (which determines per-agent availability).
 * TenantSkill represents the tenant-level catalogue view — admin enables a skill
 * at the tenant level before it can be added to specific agents.
 */
@Injectable()
export class TenantSkillsService {
  private readonly logger = new Logger(TenantSkillsService.name);

  constructor(
    @InjectRepository(TenantSkill)
    private readonly tenantSkillRepo: Repository<TenantSkill>,

    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,

    private readonly registry: SkillRegistryService,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  /**
   * Returns all globally-available skills, annotated with the tenant's
   * current enabled/config state. Skills not yet configured for the tenant
   * are included with isEnabled = false.
   */
  async listWithStatus(tenantId: string): Promise<Array<{
    skill: Skill;
    tenantConfig: TenantSkill | null;
    isEnabled: boolean;
  }>> {
    const [allSkills, tenantSkills] = await Promise.all([
      this.skillRepo.find({ where: { isActive: true }, order: { category: 'ASC', name: 'ASC' } }),
      this.tenantSkillRepo.find({ where: { tenantId }, relations: ['skill'] }),
    ]);

    const tenantMap = new Map(tenantSkills.map((ts) => [ts.skillId, ts]));

    return allSkills.map((skill) => {
      const tenantConfig = tenantMap.get(skill.id) ?? null;
      return {
        skill,
        tenantConfig,
        isEnabled: tenantConfig?.isEnabled ?? false,
      };
    });
  }

  async findOne(tenantId: string, skillId: string): Promise<TenantSkill | null> {
    return this.tenantSkillRepo.findOne({
      where: { tenantId, skillId },
      relations: ['skill'],
    });
  }

  // ─── Enable / Disable ─────────────────────────────────────────────────────

  async enable(tenantId: string, skillId: string): Promise<TenantSkill> {
    const skill = await this.skillRepo.findOne({ where: { id: skillId, isActive: true } });
    if (!skill) throw new NotFoundException(`Skill ${skillId} not found`);

    let record = await this.tenantSkillRepo.findOne({ where: { tenantId, skillId } });

    if (!record) {
      record = this.tenantSkillRepo.create({ tenantId, skillId, isEnabled: true, config: {} });
    } else {
      record.isEnabled = true;
    }

    const saved = await this.tenantSkillRepo.save(record);
    this.logger.log(`Skill ${skill.name} enabled for tenant ${tenantId}`);
    return saved;
  }

  async disable(tenantId: string, skillId: string): Promise<TenantSkill> {
    const record = await this.tenantSkillRepo.findOne({
      where: { tenantId, skillId },
      relations: ['skill'],
    });
    if (!record) throw new NotFoundException(`Skill ${skillId} is not configured for this tenant`);

    record.isEnabled = false;
    const saved = await this.tenantSkillRepo.save(record);
    this.logger.log(`Skill ${record.skill?.name ?? skillId} disabled for tenant ${tenantId}`);
    return saved;
  }

  // ─── Configure ────────────────────────────────────────────────────────────

  /**
   * Update per-tenant config overrides for a skill.
   * Config is merged, not replaced — PATCH semantics.
   * Example: { calendlyEventTypeId: 'abc123' }
   */
  async configure(
    tenantId: string,
    skillId: string,
    config: Record<string, unknown>,
  ): Promise<TenantSkill> {
    let record = await this.tenantSkillRepo.findOne({
      where: { tenantId, skillId },
      relations: ['skill'],
    });

    if (!record) {
      const skill = await this.skillRepo.findOne({ where: { id: skillId, isActive: true } });
      if (!skill) throw new NotFoundException(`Skill ${skillId} not found`);
      record = this.tenantSkillRepo.create({ tenantId, skillId, isEnabled: false, config: {} });
    }

    record.config = { ...record.config, ...config };
    return this.tenantSkillRepo.save(record);
  }
}
