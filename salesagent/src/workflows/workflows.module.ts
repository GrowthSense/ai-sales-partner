import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Workflow } from './entities/workflow.entity';
import { WorkflowExecution } from './entities/workflow-execution.entity';
import { WorkflowJob } from './entities/workflow-job.entity';

import { WorkflowService } from './services/workflow.service';
import { WorkflowTriggerService } from './services/workflow-trigger.service';
import { FollowUpWorker } from './workers/follow-up.worker';
import { WorkflowsController } from './controllers/workflows.controller';

import { IntegrationsModule } from '../integrations/integrations.module';
import { Lead } from '../leads/entities/lead.entity';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * WorkflowsModule
 *
 * Automated follow-up sequences triggered by conversation and lead events.
 *
 * Entities:
 *   Workflow           — trigger + ordered steps definition (JSONB)
 *   WorkflowExecution  — per-execution state, currentStep, append-only logs
 *   WorkflowJob        — DB audit trail for all BullMQ jobs (dead-letter tracking)
 *
 * Services:
 *   WorkflowService        — CRUD for workflow definitions + execution read access
 *   WorkflowTriggerService — starts/advances executions; exported for orchestrator
 *
 * Workers:
 *   FollowUpWorker         — executes individual steps; one job per step
 *
 * Queues consumed:
 *   follow-up              — step execution with per-step BullMQ delay
 *
 * HTTP endpoints:
 *   GET    /workflows
 *   POST   /workflows
 *   GET    /workflows/:id
 *   PATCH  /workflows/:id
 *   DELETE /workflows/:id
 *   GET    /workflows/executions
 *   GET    /workflows/executions/:id
 *
 * Exports:
 *   WorkflowTriggerService — used by AgentOrchestratorService to trigger
 *                            workflows after conversation events
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workflow,
      WorkflowExecution,
      WorkflowJob,
      Lead,
      LeadActivity,
    ]),

    BullModule.registerQueue({ name: QUEUE_NAMES.FOLLOW_UP }),

    // EmailIntegrationService + CrmIntegrationService needed by FollowUpWorker
    IntegrationsModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowService,
    WorkflowTriggerService,
    FollowUpWorker,
  ],
  exports: [
    WorkflowTriggerService,
    WorkflowService,
  ],
})
export class WorkflowsModule {}
