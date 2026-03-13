import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Lead } from './entities/lead.entity';
import { LeadActivity } from './entities/lead-activity.entity';
import { Meeting } from './entities/meeting.entity';

import { LeadsAdminService } from './services/leads-admin.service';
import { LeadsController } from './controllers/leads.controller';
import { CrmSyncWorker } from './workers/crm-sync.worker';
import { WorkflowJob } from '../workflows/entities/workflow-job.entity';
import { IntegrationsModule } from '../integrations/integrations.module';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * LeadsModule
 *
 * Admin read/update API for lead records.
 * The lead write path (upsert during conversations) lives in AgentsModule
 * via the LeadsService used by skills.
 *
 * Endpoints:
 *   GET    /leads                  — list with filters
 *   GET    /leads/:id              — detail with activities + meetings
 *   PATCH  /leads/:id              — manual admin correction
 *   POST   /leads/:id/sync-crm     — manual CRM sync trigger
 *
 * Workers:
 *   CrmSyncWorker  — @Processor('crm-sync') — pushes leads to HubSpot/Salesforce
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadActivity, Meeting, WorkflowJob]),
    BullModule.registerQueue({ name: QUEUE_NAMES.CRM_SYNC }),
    IntegrationsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsAdminService, CrmSyncWorker],
  exports: [],
})
export class LeadsModule {}
