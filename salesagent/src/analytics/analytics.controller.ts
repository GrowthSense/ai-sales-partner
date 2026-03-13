import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { AnalyticsService, AnalyticsSummary } from './analytics.service';
import { IsOptional, IsDateString } from 'class-validator';

class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  preset?: '7d' | '30d' | '90d';
}

/**
 * AnalyticsController
 *
 * Tenant admin analytics summary endpoint.
 *
 * Endpoints:
 *   GET /analytics/summary   — aggregated stats for the period
 *
 * Query params:
 *   from       — ISO date string, e.g. 2026-01-01
 *   to         — ISO date string, e.g. 2026-03-12
 *   preset     — '7d' | '30d' | '90d' (overrides from/to if provided)
 *
 * Defaults to last 30 days if no params specified.
 */
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  async getSummary(
    @TenantId() tenantId: string,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsSummary> {
    const { from, to } = this.resolvePeriod(query);
    return this.analytics.getSummary(tenantId, from, to);
  }

  private resolvePeriod(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();

    if (query.preset) {
      const days = query.preset === '7d' ? 7 : query.preset === '90d' ? 90 : 30;
      const from = new Date(to);
      from.setDate(from.getDate() - days);
      return { from, to };
    }

    if (query.from) {
      return { from: new Date(query.from), to };
    }

    // Default: last 30 days
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from, to };
  }
}
