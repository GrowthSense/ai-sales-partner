import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { SocialMediaService } from '../services/social-media.service';
import { ConnectSocialAccountDto } from '../dtos/connect-social-account.dto';
import { ResolveAlertDto } from '../dtos/resolve-alert.dto';
import { CommentSentiment, NegativeAlertStatus } from '../../common/enums';

/**
 * SocialMediaController
 *
 * All routes require a valid admin JWT (enforced by the global JwtAuthGuard).
 * tenantId is sourced from the authenticated JWT claim via @TenantId() decorator.
 */
@Controller('social-media')
export class SocialMediaController {
  constructor(private readonly service: SocialMediaService) {}

  // ─── Social Accounts ──────────────────────────────────────────────────────

  /**
   * Connect a new social media account to the tenant.
   * POST /social-media/accounts
   */
  @Post('accounts')
  async connectAccount(
    @TenantId() tenantId: string,
    @Body() dto: ConnectSocialAccountDto,
  ) {
    return this.service.connectAccount(tenantId, dto);
  }

  /**
   * List all connected social accounts for the tenant.
   * GET /social-media/accounts
   */
  @Get('accounts')
  async listAccounts(@TenantId() tenantId: string) {
    return this.service.listAccounts(tenantId);
  }

  /**
   * Disconnect and remove a social account.
   * DELETE /social-media/accounts/:id
   */
  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnectAccount(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) accountId: string,
  ) {
    await this.service.disconnectAccount(tenantId, accountId);
  }

  // ─── Manual Sync ─────────────────────────────────────────────────────────

  /**
   * Trigger an immediate comment fetch for all active accounts.
   * POST /social-media/sync
   */
  @Post('sync')
  async triggerSync(@TenantId() tenantId: string) {
    return this.service.triggerSync(tenantId);
  }

  // ─── Negative Comment Alerts ──────────────────────────────────────────────

  /**
   * List negative/critical comment alerts with optional filters.
   * GET /social-media/alerts?status=open&sentiment=critical&limit=20&offset=0
   */
  @Get('alerts')
  async listAlerts(
    @TenantId() tenantId: string,
    @Query('status') status?: NegativeAlertStatus,
    @Query('sentiment') sentiment?: CommentSentiment,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listAlerts(tenantId, {
      status,
      sentiment,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Mark an alert as resolved with optional notes.
   * POST /social-media/alerts/:id/resolve
   */
  @Post('alerts/:id/resolve')
  async resolveAlert(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) alertId: string,
    @Body() dto: ResolveAlertDto,
  ) {
    return this.service.resolveAlert(tenantId, alertId, dto);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  /**
   * Dashboard stats for social media monitoring.
   * GET /social-media/stats
   */
  @Get('stats')
  async getStats(@TenantId() tenantId: string) {
    return this.service.getStats(tenantId);
  }
}
