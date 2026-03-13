import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { SocialAccount } from './entities/social-account.entity';
import { SocialComment } from './entities/social-comment.entity';
import { CommentAnalysis } from './entities/comment-analysis.entity';
import { NegativeCommentAlert } from './entities/negative-comment-alert.entity';

import { FacebookClient } from './adapters/facebook.client';
import { InstagramClient } from './adapters/instagram.client';
import { TwitterClient } from './adapters/twitter.client';
import { LinkedInClient } from './adapters/linkedin.client';

import { CommentAnalyzerService } from './services/comment-analyzer.service';
import { SocialMediaService } from './services/social-media.service';

import { SocialCommentFetchWorker } from './workers/comment-fetch.worker';
import { SocialCommentAnalyzeWorker } from './workers/comment-analysis.worker';

import { SocialMediaController } from './controllers/social-media.controller';

import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

// Entities from other modules needed by workers
import { Lead } from '../leads/entities/lead.entity';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

import { CommonModule } from '../common/common.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SocialAccount,
      SocialComment,
      CommentAnalysis,
      NegativeCommentAlert,
      // Cross-module entities used by workers
      Lead,
      LeadActivity,
      Tenant,
    ]),

    BullModule.registerQueue(
      { name: QUEUE_NAMES.SOCIAL_COMMENT_FETCH },
      { name: QUEUE_NAMES.SOCIAL_COMMENT_ANALYZE },
      // Workers produce jobs to these existing queues
      { name: QUEUE_NAMES.CRM_SYNC },
      { name: QUEUE_NAMES.NOTIFICATIONS },
    ),

    CommonModule,
    WebsocketModule,
  ],

  controllers: [SocialMediaController],

  providers: [
    // Adapters
    FacebookClient,
    InstagramClient,
    TwitterClient,
    LinkedInClient,

    // Services
    CommentAnalyzerService,
    SocialMediaService,

    // Workers
    SocialCommentFetchWorker,
    SocialCommentAnalyzeWorker,
  ],

  exports: [SocialMediaService],
})
export class SocialMediaModule {}
