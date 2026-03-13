import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { SocialAccount } from '../entities/social-account.entity';
import { SocialComment } from '../entities/social-comment.entity';
import { NegativeCommentAlert } from '../entities/negative-comment-alert.entity';
import {
  SocialPlatform,
  SocialAccountStatus,
  CommentSentiment,
  NegativeAlertStatus,
} from '../../common/enums';
import {
  QUEUE_NAMES,
  RETRY_CONFIGS,
} from '../../common/types/queue-jobs.types';
import { EncryptionService } from '../../common/services/encryption.service';
import { SocialAccountCredentials } from '../entities/social-account.entity';
import { ConnectSocialAccountDto } from '../dtos/connect-social-account.dto';
import { ResolveAlertDto } from '../dtos/resolve-alert.dto';

/**
 * SocialMediaService
 *
 * Central service for managing connected social accounts and surfacing
 * negative comment alerts. Fetch + analysis work is delegated to workers.
 */
@Injectable()
export class SocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);

  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,

    @InjectRepository(SocialComment)
    private readonly commentRepo: Repository<SocialComment>,

    @InjectRepository(NegativeCommentAlert)
    private readonly alertRepo: Repository<NegativeCommentAlert>,

    @InjectQueue(QUEUE_NAMES.SOCIAL_COMMENT_FETCH)
    private readonly fetchQueue: Queue,

    private readonly encryption: EncryptionService,
  ) {}

  // ─── Account management ──────────────────────────────────────────────────

  async connectAccount(
    tenantId: string,
    dto: ConnectSocialAccountDto,
  ): Promise<SocialAccount> {
    const encrypted = this.encryption.encrypt(
      JSON.stringify({ accessToken: dto.accessToken, ...dto.platformConfig }),
    ) as SocialAccountCredentials;

    const account = this.accountRepo.create({
      tenantId,
      platform: dto.platform,
      externalId: dto.externalId,
      handle: dto.handle,
      status: SocialAccountStatus.ACTIVE,
      credentials: encrypted,
      config: dto.platformConfig ?? {},
      lastSyncedAt: null,
    });

    const saved = await this.accountRepo.save(account);
    this.logger.log(
      `Social account connected: tenant=${tenantId} platform=${dto.platform} handle=${dto.handle}`,
    );
    return saved;
  }

  async disconnectAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId, tenantId },
    });
    if (!account) throw new NotFoundException('Social account not found');

    await this.accountRepo.update(
      { id: accountId, tenantId },
      { status: SocialAccountStatus.INACTIVE, credentials: null },
    );
  }

  async listAccounts(tenantId: string): Promise<SocialAccount[]> {
    return this.accountRepo.find({ where: { tenantId } });
  }

  // ─── Manual sync trigger ─────────────────────────────────────────────────

  /**
   * Enqueue a fetch job for every active account belonging to this tenant.
   * Called on-demand by the admin or by a cron scheduler.
   */
  async triggerSync(tenantId: string): Promise<{ queued: number }> {
    const accounts = await this.accountRepo.find({
      where: { tenantId, status: SocialAccountStatus.ACTIVE },
    });

    for (const account of accounts) {
      await this.fetchQueue.add(
        'comment-fetch',
        { tenantId, accountId: account.id },
        RETRY_CONFIGS.TRANSIENT,
      );
    }

    this.logger.log(
      `Sync triggered for tenant=${tenantId}: queued ${accounts.length} fetch jobs`,
    );

    return { queued: accounts.length };
  }

  // ─── Alert management ────────────────────────────────────────────────────

  async listAlerts(
    tenantId: string,
    options?: {
      status?: NegativeAlertStatus;
      sentiment?: CommentSentiment;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ alerts: NegativeCommentAlert[]; total: number }> {
    const qb = this.alertRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.comment', 'comment')
      .where('a.tenant_id = :tenantId', { tenantId });

    if (options?.status) qb.andWhere('a.status = :status', { status: options.status });
    if (options?.sentiment) qb.andWhere('a.sentiment = :sentiment', { sentiment: options.sentiment });

    qb.orderBy('a.created_at', 'DESC')
      .take(options?.limit ?? 50)
      .skip(options?.offset ?? 0);

    const [alerts, total] = await qb.getManyAndCount();
    return { alerts, total };
  }

  async resolveAlert(
    tenantId: string,
    alertId: string,
    dto: ResolveAlertDto,
  ): Promise<NegativeCommentAlert> {
    const alert = await this.alertRepo.findOne({
      where: { id: alertId, tenantId },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    alert.status = NegativeAlertStatus.RESOLVED;
    alert.resolutionNotes = dto.notes ?? null;
    alert.resolvedAt = new Date();

    return this.alertRepo.save(alert);
  }

  // ─── Dashboard stats ─────────────────────────────────────────────────────

  async getStats(tenantId: string): Promise<{
    totalComments: number;
    negative: number;
    critical: number;
    openAlerts: number;
    leadsGenerated: number;
  }> {
    const [
      totalComments,
      negative,
      critical,
      openAlerts,
      leadsGenerated,
    ] = await Promise.all([
      this.commentRepo.count({ where: { tenantId } }),
      this.alertRepo.count({
        where: { tenantId, sentiment: CommentSentiment.NEGATIVE },
      }),
      this.alertRepo.count({
        where: { tenantId, sentiment: CommentSentiment.CRITICAL },
      }),
      this.alertRepo.count({
        where: { tenantId, status: NegativeAlertStatus.OPEN },
      }),
      // Count comments that were converted to leads
      this.commentRepo.manager
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from('comment_analyses', 'ca')
        .where('ca.tenant_id = :tenantId', { tenantId })
        .andWhere('ca.lead_id IS NOT NULL')
        .getRawOne<{ count: string }>()
        .then((r) => parseInt(r?.count ?? '0', 10)),
    ]);

    return { totalComments, negative, critical, openAlerts, leadsGenerated };
  }
}
