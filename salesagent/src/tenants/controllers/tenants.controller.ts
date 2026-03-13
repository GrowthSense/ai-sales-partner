import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TenantsService } from '../services/tenants.service';
import { Tenant } from '../entities/tenant.entity';
import { CreateTenantDto } from '../dtos/create-tenant.dto';
import { UpdateTenantDto } from '../dtos/update-tenant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TenantPlan } from '../../common/enums';

/**
 * TenantsController
 *
 * Tenant management endpoints:
 *
 *   POST   /tenants               — create tenant (super-admin only)
 *   GET    /tenants               — list all tenants (super-admin only)
 *   GET    /tenants/me            — current tenant details (from JWT)
 *   GET    /tenants/:id           — tenant details (super-admin or own tenant)
 *   PATCH  /tenants/:id           — update name, plan, settings
 *   POST   /tenants/:id/rotate-widget-key — rotate widget embed key
 *   GET    /widget-config/:widgetKey      — public endpoint for JS widget bootstrap
 */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // ─── Super-admin: create ───────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateTenantDto): Promise<Tenant> {
    return this.tenants.create(dto);
  }

  // ─── Super-admin: list ────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('plan') plan?: string,
    @Query('isActive') isActive?: string,
  ): Promise<{ items: Tenant[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.tenants.findAll(
      {
        ...(plan ? { plan: plan as TenantPlan } : {}),
        ...(isActive !== undefined ? { isActive: isActive !== 'false' } : {}),
      },
      { page, limit },
    );
    return { items, total, page, limit };
  }

  // ─── Current tenant (from JWT) ────────────────────────────────────────────

  /**
   * GET /tenants/me
   * Returns the tenant for the currently authenticated admin user.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@TenantId() tenantId: string): Promise<Tenant> {
    return this.tenants.findById(tenantId);
  }

  // ─── Get by ID ────────────────────────────────────────────────────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Tenant> {
    return this.tenants.findById(id);
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<Tenant> {
    return this.tenants.update(id, dto);
  }

  // ─── Widget key rotation ──────────────────────────────────────────────────

  /**
   * POST /tenants/:id/rotate-widget-key
   *
   * Generates a new widgetKey UUID. Old embedded widgets will stop working
   * immediately. Use only after a suspected key compromise.
   */
  @Post(':id/rotate-widget-key')
  @UseGuards(JwtAuthGuard)
  async rotateWidgetKey(@Param('id', ParseUUIDPipe) id: string): Promise<{ widgetKey: string }> {
    const tenant = await this.tenants.rotateWidgetKey(id);
    return { widgetKey: tenant.widgetKey };
  }
}

/**
 * WidgetConfigController
 *
 * Public endpoint — no auth required.
 * Called by the visitor JS widget on load to get branding + agent name.
 */
@Controller('widget-config')
export class WidgetConfigController {
  constructor(private readonly tenants: TenantsService) {}

  @Get(':widgetKey')
  async getWidgetConfig(
    @Param('widgetKey', ParseUUIDPipe) widgetKey: string,
  ): Promise<{
    widgetKey: string;
    agentName: string;
    primaryColor: string;
    logoUrl: string | null;
    greetingMessage: string;
  }> {
    return this.tenants.getWidgetConfig(widgetKey);
  }
}
