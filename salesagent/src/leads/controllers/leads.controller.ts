import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { LeadsAdminService } from '../services/leads-admin.service';
import { Lead } from '../entities/lead.entity';
import { ListLeadsDto } from '../dtos/list-leads.dto';
import { UpdateLeadDto } from '../dtos/update-lead.dto';

/**
 * LeadsController
 *
 * Admin read/update API for lead records.
 * All leads are tenant-scoped and created automatically by agent skills.
 * This controller provides human review and manual correction capabilities.
 *
 * Endpoints:
 *   GET    /leads                  — list with filters (status, score, date, email)
 *   GET    /leads/:id              — lead detail with qualification data + activities
 *   PATCH  /leads/:id              — manual admin update (correct data, change status)
 *   POST   /leads/:id/sync-crm    — manually trigger CRM push
 */
@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsAdmin: LeadsAdminService) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query() query: ListLeadsDto,
  ): Promise<{ items: Lead[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.leadsAdmin.findAll(tenantId, query);
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Lead> {
    return this.leadsAdmin.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ): Promise<Lead> {
    return this.leadsAdmin.update(id, tenantId, dto);
  }

  /**
   * POST /leads/:id/sync-crm
   *
   * Manually trigger a CRM sync for this lead.
   * Useful when the automatic sync failed or to force a re-sync after
   * manual data corrections.
   */
  @Post(':id/sync-crm')
  async syncCrm(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ queued: boolean; jobId: string }> {
    return this.leadsAdmin.syncToCrm(id, tenantId);
  }
}
