import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Tenant, TenantSettings } from '../entities/tenant.entity';
import { TenantPlan } from '../../common/enums';
import { CreateTenantDto } from '../dtos/create-tenant.dto';
import { UpdateTenantDto } from '../dtos/update-tenant.dto';

export interface TenantListFilters {
  plan?: TenantPlan;
  isActive?: boolean;
}

/**
 * TenantsService
 *
 * Manages the tenant lifecycle. Tenant creation is super-admin only.
 * All other methods are usable by tenant-scoped admin users (guarded by JWT tenantId).
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // ─── Create (super-admin) ─────────────────────────────────────────────────

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const slug = this.generateSlug(dto.name);

    const existing = await this.tenantRepo.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`A tenant with slug "${slug}" already exists`);
    }

    const defaultSettings: TenantSettings = {
      branding: {
        primaryColor: '#4F46E5',
        logoUrl: null,
        agentName: 'Assistant',
        greetingMessage: 'Hi! How can I help you today?',
      },
      allowedDomains: [],
      timezone: 'UTC',
      conversationRetentionDays: 365,
      leadNotificationEmail: null,
    };

    const tenant = this.tenantRepo.create({
      name: dto.name,
      slug,
      widgetKey: randomUUID(),
      plan: dto.plan ?? TenantPlan.FREE,
      isActive: true,
      settings: {
        ...defaultSettings,
        ...dto.settings,
        branding: {
          ...defaultSettings.branding,
          ...dto.settings?.branding,
        },
      },
    });

    const saved = await this.tenantRepo.save(tenant);
    this.logger.log(`Tenant created: id=${saved.id} slug=${saved.slug} plan=${saved.plan}`);
    return saved;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  async findByWidgetKey(widgetKey: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { widgetKey, isActive: true } });
    if (!tenant) throw new NotFoundException(`No active tenant for widget key`);
    return tenant;
  }

  async findAll(
    filters: TenantListFilters,
    pagination: { page: number; limit: number },
  ): Promise<[Tenant[], number]> {
    const qb = this.tenantRepo
      .createQueryBuilder('t')
      .orderBy('t.created_at', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);

    if (filters.plan) qb.andWhere('t.plan = :plan', { plan: filters.plan });
    if (filters.isActive !== undefined) {
      qb.andWhere('t.is_active = :isActive', { isActive: filters.isActive });
    }

    return qb.getManyAndCount();
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);

    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.plan !== undefined) tenant.plan = dto.plan;
    if (dto.isActive !== undefined) tenant.isActive = dto.isActive;
    if (dto.settings !== undefined) {
      tenant.settings = {
        ...tenant.settings,
        ...dto.settings,
        branding: {
          ...tenant.settings.branding,
          ...dto.settings.branding,
        },
      };
    }

    return this.tenantRepo.save(tenant);
  }

  // ─── Widget key rotation ──────────────────────────────────────────────────

  /**
   * Rotate the widget key. Existing embedded widgets will stop working
   * until updated with the new key. Use after a suspected compromise.
   */
  async rotateWidgetKey(id: string): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.widgetKey = randomUUID();
    const saved = await this.tenantRepo.save(tenant);
    this.logger.warn(`Widget key rotated for tenant: id=${id}`);
    return saved;
  }

  // ─── Widget config (public, no auth) ─────────────────────────────────────

  async getWidgetConfig(widgetKey: string): Promise<{
    widgetKey: string;
    agentName: string;
    primaryColor: string;
    logoUrl: string | null;
    greetingMessage: string;
  }> {
    const tenant = await this.findByWidgetKey(widgetKey);
    const branding = tenant.settings?.branding;
    return {
      widgetKey: tenant.widgetKey,
      agentName: branding?.agentName ?? 'Assistant',
      primaryColor: branding?.primaryColor ?? '#4F46E5',
      logoUrl: branding?.logoUrl ?? null,
      greetingMessage: branding?.greetingMessage ?? 'Hi! How can I help you today?',
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 50);

    // Append short random suffix for uniqueness
    const suffix = Math.random().toString(36).slice(2, 7);
    return `${base}-${suffix}`;
  }
}
