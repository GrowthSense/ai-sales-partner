import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { SocialAccount } from '../entities/social-account.entity';
import { SocialComment } from '../entities/social-comment.entity';
import { SocialAccountStatus, SocialPlatform } from '../../common/enums';
import {
  QUEUE_NAMES,
  RETRY_CONFIGS,
  SocialCommentFetchJob,
  SocialCommentAnalyzeJob,
} from '../../common/types/queue-jobs.types';
import { EncryptionService } from '../../common/services/encryption.service';
import { SocialAccountCredentials } from '../entities/social-account.entity';
import { FacebookClient } from '../adapters/facebook.client';
import { InstagramClient } from '../adapters/instagram.client';
import { TwitterClient } from '../adapters/twitter.client';
import { LinkedInClient } from '../adapters/linkedin.client';
import { ISocialAdapter, SocialAccountConfig } from '../interfaces/social-adapter.interface';

/**
 * SocialCommentFetchWorker
 *
 * Fetches new comments from a connected social account via the platform API.
 * Persists raw comments (idempotent by externalId+platform) and enqueues
 * an analysis job for each new comment.
 *
 * Concurrency: 2 — social APIs have rate limits; keep low.
 */
@Processor(QUEUE_NAMES.SOCIAL_COMMENT_FETCH, { concurrency: 2 })
export class SocialCommentFetchWorker extends WorkerHost {
  private readonly logger = new Logger(SocialCommentFetchWorker.name);

  private readonly adapters: Map<SocialPlatform, ISocialAdapter> = new Map();

  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,

    @InjectRepository(SocialComment)
    private readonly commentRepo: Repository<SocialComment>,

    @InjectQueue(QUEUE_NAMES.SOCIAL_COMMENT_ANALYZE)
    private readonly analyzeQueue: Queue<SocialCommentAnalyzeJob>,

    private readonly encryption: EncryptionService,
    private readonly facebook: FacebookClient,
    private readonly instagram: InstagramClient,
    private readonly twitter: TwitterClient,
    private readonly linkedin: LinkedInClient,
  ) {
    super();
    this.adapters.set(SocialPlatform.FACEBOOK, facebook);
    this.adapters.set(SocialPlatform.INSTAGRAM, instagram);
    this.adapters.set(SocialPlatform.TWITTER, twitter);
    this.adapters.set(SocialPlatform.LINKEDIN, linkedin);
  }

  async process(job: Job<SocialCommentFetchJob>): Promise<void> {
    const { tenantId, accountId } = job.data;

    // Load account with credentials (select: false by default — must be explicit)
    const account = await this.accountRepo
      .createQueryBuilder('a')
      .addSelect('a.credentials')
      .where('a.id = :id', { id: accountId })
      .andWhere('a.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!account) {
      this.logger.warn(`Account ${accountId} not found for tenant ${tenantId} — skipping`);
      return;
    }

    if (account.status !== SocialAccountStatus.ACTIVE) {
      this.logger.debug(`Account ${accountId} is ${account.status} — skipping`);
      return;
    }

    if (!account.credentials) {
      this.logger.warn(`Account ${accountId} has no credentials — skipping`);
      await this.accountRepo.update(
        { id: accountId, tenantId },
        { status: SocialAccountStatus.ERROR, errorMessage: 'Missing credentials' },
      );
      return;
    }

    // Decrypt credentials
    const decrypted = this.encryption.decryptJson<SocialAccountConfig>(
      account.credentials as SocialAccountCredentials,
    );

    const adapter = this.adapters.get(account.platform);
    if (!adapter) {
      this.logger.error(`No adapter for platform ${account.platform}`);
      return;
    }

    // Fetch comments since last sync
    const rawComments = await adapter.getComments(decrypted, account.lastSyncedAt);

    this.logger.log(
      `Fetched ${rawComments.length} comments from ${account.platform} for account ${accountId}`,
    );

    let newCount = 0;
    for (const raw of rawComments) {
      // Idempotent upsert — skip if already stored
      const exists = await this.commentRepo.findOne({
        where: { externalId: raw.externalId, platform: raw.platform },
      });
      if (exists) continue;

      const comment = await this.commentRepo.save(
        this.commentRepo.create({
          tenantId,
          accountId,
          platform: raw.platform,
          externalId: raw.externalId,
          text: raw.text,
          authorName: raw.authorName,
          authorUsername: raw.authorUsername,
          authorEmail: raw.authorEmail,
          publishedAt: raw.publishedAt,
          postUrl: raw.postUrl,
        }),
      );

      // Enqueue analysis for every new comment
      await this.analyzeQueue.add(
        'comment-analyze',
        { tenantId, commentId: comment.id },
        RETRY_CONFIGS.TRANSIENT,
      );

      newCount++;
    }

    // Update last synced timestamp
    await this.accountRepo.update(
      { id: accountId, tenantId },
      {
        lastSyncedAt: new Date(),
        errorMessage: null,
        status: SocialAccountStatus.ACTIVE,
      },
    );

    this.logger.log(
      `Processed ${newCount} new comments for account ${accountId} (${account.handle})`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SocialCommentFetchJob> | undefined, err: Error): void {
    if (!job) return;
    const { accountId, tenantId } = job.data;
    this.logger.error(
      `Fetch failed for account ${accountId} tenant ${tenantId}: ${err.message}`,
    );
    // Mark account as ERROR so the admin can see it in the dashboard
    void this.accountRepo.update(
      { id: accountId, tenantId },
      { status: SocialAccountStatus.ERROR, errorMessage: err.message },
    );
  }
}
