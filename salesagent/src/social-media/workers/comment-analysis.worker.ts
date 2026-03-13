import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { CommentAnalysis } from '../entities/comment-analysis.entity';
import { NegativeCommentAlert } from '../entities/negative-comment-alert.entity';
import { SocialComment } from '../entities/social-comment.entity';
import { CommentAnalyzerService } from '../services/comment-analyzer.service';
import { WsRoomsService } from '../../websocket/services/ws-rooms.service';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadActivity } from '../../leads/entities/lead-activity.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  CommentSentiment,
  LeadSource,
  LeadStatus,
  LeadActivityType,
  NegativeAlertStatus,
} from '../../common/enums';
import {
  QUEUE_NAMES,
  RETRY_CONFIGS,
  SocialCommentAnalyzeJob,
  NotificationJob,
} from '../../common/types/queue-jobs.types';
import { ServerEvents } from '../../websocket/interfaces/ws-events.enum';

/**
 * SocialCommentAnalyzeWorker
 *
 * Runs OpenAI sentiment + lead-signal analysis on a raw social comment.
 * Side effects:
 *  1. Persists CommentAnalysis record.
 *  2. If lead signal detected → creates a Lead (source=SOCIAL_MEDIA) + enqueues CRM sync.
 *  3. If sentiment is NEGATIVE or CRITICAL → creates NegativeCommentAlert,
 *     emits dashboard WebSocket event, enqueues notification email.
 *
 * Concurrency: 5 — OpenAI calls are I/O-bound; parallelism helps throughput.
 */
@Processor(QUEUE_NAMES.SOCIAL_COMMENT_ANALYZE, { concurrency: 5 })
export class SocialCommentAnalyzeWorker extends WorkerHost {
  private readonly logger = new Logger(SocialCommentAnalyzeWorker.name);

  constructor(
    @InjectRepository(SocialComment)
    private readonly commentRepo: Repository<SocialComment>,

    @InjectRepository(CommentAnalysis)
    private readonly analysisRepo: Repository<CommentAnalysis>,

    @InjectRepository(NegativeCommentAlert)
    private readonly alertRepo: Repository<NegativeCommentAlert>,

    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,

    @InjectRepository(LeadActivity)
    private readonly activityRepo: Repository<LeadActivity>,

    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,

    @InjectQueue(QUEUE_NAMES.CRM_SYNC)
    private readonly crmQueue: Queue,

    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS)
    private readonly notificationsQueue: Queue<NotificationJob>,

    private readonly analyzer: CommentAnalyzerService,
    private readonly wsRooms: WsRoomsService,
  ) {
    super();
  }

  async process(job: Job<SocialCommentAnalyzeJob>): Promise<void> {
    const { tenantId, commentId } = job.data;

    // Skip if already analyzed (idempotent)
    const alreadyDone = await this.analysisRepo.findOne({
      where: { commentId, tenantId },
    });
    if (alreadyDone) return;

    const comment = await this.commentRepo.findOne({
      where: { id: commentId, tenantId },
    });
    if (!comment) {
      this.logger.warn(`Comment ${commentId} not found — skipping`);
      return;
    }

    // ── 1. Run LLM analysis ──────────────────────────────────────────────────
    const result = await this.analyzer.analyze(comment.text);

    // ── 2. Persist analysis ──────────────────────────────────────────────────
    const analysis = await this.analysisRepo.save(
      this.analysisRepo.create({
        tenantId,
        commentId,
        sentiment: result.sentiment,
        sentimentScore: result.sentimentScore,
        sentimentReason: result.sentimentReason,
        isLeadSignal: result.isLeadSignal,
        leadSignals: result.leadSignals,
        extractedEmails: result.extractedEmails,
        extractedPhones: result.extractedPhones,
        suggestedActions: result.suggestedActions,
        leadId: null,
        analyzedAt: new Date(),
      }),
    );

    // ── 3. Create lead if signal detected ────────────────────────────────────
    if (result.isLeadSignal) {
      const lead = await this.createLeadFromComment(tenantId, comment, result);

      // Update analysis with the lead ID
      await this.analysisRepo.update(analysis.id, { leadId: lead.id });

      // Enqueue CRM sync
      await this.crmQueue.add(
        'crm-sync',
        { tenantId, leadId: lead.id },
        RETRY_CONFIGS.RESILIENT,
      );

      // Notify dashboard of new lead
      this.wsRooms.emitToTenantLeads(tenantId, {
        leadId: lead.id,
        source: LeadSource.SOCIAL_MEDIA,
        platform: comment.platform,
        authorName: comment.authorName,
        email: lead.email,
        score: lead.score,
        createdAt: lead.createdAt,
      });

      this.logger.log(
        `Lead created from social comment: leadId=${lead.id} platform=${comment.platform}`,
      );
    }

    // ── 4. Handle negative/critical comments ─────────────────────────────────
    const isNegative =
      result.sentiment === CommentSentiment.NEGATIVE ||
      result.sentiment === CommentSentiment.CRITICAL;

    if (isNegative) {
      await this.raiseAlert(tenantId, comment, analysis, result.sentiment);
    }

    this.logger.debug(
      `Analyzed comment ${commentId}: sentiment=${result.sentiment} leadSignal=${result.isLeadSignal}`,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async createLeadFromComment(
    tenantId: string,
    comment: SocialComment,
    result: Awaited<ReturnType<CommentAnalyzerService['analyze']>>,
  ): Promise<Lead> {
    const email =
      result.extractedEmails[0] ??
      comment.authorEmail ??
      null;

    const phone = result.extractedPhones[0] ?? null;

    const [firstName, ...rest] = comment.authorName.split(' ');
    const lastName = rest.join(' ') || null;

    // Use comment ID as synthetic conversationId (unique per comment)
    const lead = await this.leadRepo.save(
      this.leadRepo.create({
        tenantId,
        // Social media leads use the comment ID as a synthetic conversation reference
        conversationId: comment.id,
        visitorId: comment.id,
        source: LeadSource.SOCIAL_MEDIA,
        status: email || phone ? LeadStatus.CONTACTED : LeadStatus.NEW,
        firstName,
        lastName,
        email,
        phone,
        qualificationData: {
          budget: null,
          hasBudget: null,
          authority: null,
          isDecisionMaker: null,
          need: result.leadSignals,
          needStrength: 'low',
          timeline: null,
          hasTimeline: null,
          notes: `From ${comment.platform} comment: ${comment.text.slice(0, 200)}`,
        },
        score: 5, // Minimum score — needs qualification via the agent
        attribution: {
          utmSource: comment.platform,
          utmMedium: 'social',
          referrer: comment.postUrl ?? undefined,
        },
      }),
    );

    await this.activityRepo.save(
      this.activityRepo.create({
        tenantId,
        leadId: lead.id,
        type: LeadActivityType.CREATED,
        description: `Lead created from ${comment.platform} comment by ${comment.authorName}`,
        actorType: 'system',
        metadata: { platform: comment.platform, commentId: comment.id },
      }),
    );

    return lead;
  }

  private async raiseAlert(
    tenantId: string,
    comment: SocialComment,
    analysis: CommentAnalysis,
    sentiment: CommentSentiment,
  ): Promise<void> {
    const alert = await this.alertRepo.save(
      this.alertRepo.create({
        tenantId,
        commentId: comment.id,
        sentiment,
        alertReason: analysis.sentimentReason ?? 'Negative comment detected',
        status: NegativeAlertStatus.OPEN,
        wsEmitted: false,
        emailSent: false,
      }),
    );

    // Emit to dashboard WebSocket room
    this.wsRooms.emitNegativeComment(tenantId, {
      alertId: alert.id,
      commentId: comment.id,
      platform: comment.platform,
      authorName: comment.authorName,
      authorUsername: comment.authorUsername,
      text: comment.text,
      postUrl: comment.postUrl,
      sentiment,
      reason: alert.alertReason,
      suggestedActions: analysis.suggestedActions,
      createdAt: alert.createdAt,
    });

    await this.alertRepo.update(alert.id, { wsEmitted: true });

    // Enqueue email notification
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const notificationEmail = tenant?.settings?.leadNotificationEmail;

    if (notificationEmail) {
      await this.notificationsQueue.add(
        'negative-comment-alert',
        {
          tenantId,
          event: 'social.negative_comment',
          payload: {
            alertId: alert.id,
            recipientEmail: notificationEmail,
            platform: comment.platform,
            authorName: comment.authorName,
            text: comment.text,
            postUrl: comment.postUrl,
            sentiment,
            reason: alert.alertReason,
            suggestedActions: analysis.suggestedActions,
          },
        },
        RETRY_CONFIGS.RESILIENT,
      );

      await this.alertRepo.update(alert.id, {
        emailSent: true,
        emailSentAt: new Date(),
      });
    }

    this.logger.warn(
      `Negative comment alert raised: alertId=${alert.id} sentiment=${sentiment} platform=${comment.platform}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SocialCommentAnalyzeJob> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error(
      `Analysis failed for comment ${job.data.commentId}: ${err.message}`,
    );
  }
}
