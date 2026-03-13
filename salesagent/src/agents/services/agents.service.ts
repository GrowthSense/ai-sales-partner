import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Agent } from '../entities/agent.entity';
import { AgentConfig, LlmConfig, RagConfig } from '../entities/agent-config.entity';
import { AgentStatus } from '../../common/enums';
import { CreateAgentDto } from '../dtos/create-agent.dto';
import { UpdateAgentDto } from '../dtos/update-agent.dto';

/**
 * AgentsService
 *
 * CRUD for agent definitions + their inline configs.
 * Agent creation is atomic (Agent + AgentConfig in a single transaction).
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,

    @InjectRepository(AgentConfig)
    private readonly configRepo: Repository<AgentConfig>,

    private readonly dataSource: DataSource,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateAgentDto, tenantId: string): Promise<Agent> {
    const slug = dto.slug ?? this.generateSlug(dto.name);

    const existing = await this.agentRepo.findOne({ where: { tenantId, slug } });
    if (existing) throw new ConflictException(`Agent slug "${slug}" already exists for this tenant`);

    const defaultLlm: LlmConfig = {
      model: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 4096,
      streaming: true,
    };

    const defaultRag: RagConfig = {
      topK: 5,
      rerankEnabled: true,
      rerankTimeoutMs: 300,
      hybridSearchWeight: 0.7,
    };

    return this.dataSource.transaction(async (manager) => {
      const config = manager.create(AgentConfig, {
        tenantId,
        persona: dto.persona,
        fallbackMessage: dto.fallbackMessage ?? null,
        llmConfig: { ...defaultLlm, ...dto.llmConfig },
        ragConfig: { ...defaultRag, ...dto.ragConfig },
        stageConfig: dto.stageConfig ?? {},
        templateVars: dto.templateVars ?? {},
      });
      const savedConfig = await manager.save(AgentConfig, config);

      const agent = manager.create(Agent, {
        tenantId,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        status: AgentStatus.DRAFT,
        enabledSkills: dto.enabledSkills ?? [],
        configId: savedConfig.id,
      });
      const savedAgent = await manager.save(Agent, agent);
      savedAgent.config = savedConfig;
      return savedAgent;
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async findById(id: string, tenantId: string): Promise<Agent> {
    const agent = await this.agentRepo.findOne({
      where: { id, tenantId },
      relations: ['config'],
    });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    return agent;
  }

  async findByTenant(tenantId: string): Promise<Agent[]> {
    return this.agentRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateAgentDto, tenantId: string): Promise<Agent> {
    const agent = await this.findById(id, tenantId);

    return this.dataSource.transaction(async (manager) => {
      // Update Agent fields
      if (dto.name !== undefined) agent.name = dto.name;
      if (dto.description !== undefined) agent.description = dto.description ?? null;
      if (dto.status !== undefined) agent.status = dto.status;
      if (dto.enabledSkills !== undefined) agent.enabledSkills = dto.enabledSkills;
      if (dto.status === AgentStatus.ACTIVE && !agent.deployedAt) {
        agent.deployedAt = new Date();
      }
      await manager.save(Agent, agent);

      // Update AgentConfig fields (always load config for update)
      if (agent.configId) {
        const config = await manager.findOne(AgentConfig, {
          where: { id: agent.configId, tenantId },
        });
        if (config) {
          if (dto.persona !== undefined) config.persona = dto.persona;
          if (dto.fallbackMessage !== undefined) config.fallbackMessage = dto.fallbackMessage ?? null;
          if (dto.llmConfig !== undefined) config.llmConfig = { ...config.llmConfig, ...dto.llmConfig };
          if (dto.ragConfig !== undefined) config.ragConfig = { ...config.ragConfig, ...dto.ragConfig };
          if (dto.stageConfig !== undefined) config.stageConfig = dto.stageConfig;
          if (dto.templateVars !== undefined) config.templateVars = dto.templateVars;
          agent.config = await manager.save(AgentConfig, config);
        }
      }

      return agent;
    });
  }

  // ─── Skill management ─────────────────────────────────────────────────────

  async setSkills(id: string, skills: string[], tenantId: string): Promise<Agent> {
    const agent = await this.findById(id, tenantId);
    agent.enabledSkills = [...new Set(skills)]; // deduplicate
    return this.agentRepo.save(agent);
  }

  async enableSkill(id: string, skillName: string, tenantId: string): Promise<Agent> {
    const agent = await this.findById(id, tenantId);
    if (!agent.enabledSkills.includes(skillName)) {
      agent.enabledSkills = [...agent.enabledSkills, skillName];
      await this.agentRepo.save(agent);
    }
    return agent;
  }

  async disableSkill(id: string, skillName: string, tenantId: string): Promise<Agent> {
    const agent = await this.findById(id, tenantId);
    agent.enabledSkills = agent.enabledSkills.filter((s) => s !== skillName);
    return this.agentRepo.save(agent);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async deploy(id: string, tenantId: string): Promise<Agent> {
    const agent = await this.findById(id, tenantId);
    if (!agent.configId) throw new BadRequestException('Agent has no configuration — configure it before deploying');
    agent.status = AgentStatus.ACTIVE;
    agent.deployedAt = new Date();
    return this.agentRepo.save(agent);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const agent = await this.findById(id, tenantId);
    await this.agentRepo.softDelete({ id: agent.id, tenantId });
    this.logger.log(`Agent soft-deleted: id=${id} tenantId=${tenantId}`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 100);
  }
}
