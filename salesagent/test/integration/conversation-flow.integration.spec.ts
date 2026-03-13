/**
 * Conversation Flow — Integration Tests
 *
 * These tests run against a real PostgreSQL database (via docker-compose).
 * No DB mocking — the goal is to catch real constraint, trigger, and
 * JOIN issues that unit tests can miss.
 *
 * Prerequisites:
 *   docker compose up -d postgres redis
 *   npm run migration:run
 *   npm run test:integration
 *
 * Tenant and agent fixtures are created fresh per-describe block and
 * cleaned up in afterAll to keep the DB state predictable.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConversationsService } from '../../src/conversations/services/conversations.service';
import { MessagesService } from '../../src/conversations/services/messages.service';
import { LeadsService } from '../../src/leads/services/leads.service';
import { StageStateMachineService } from '../../src/agents/services/stage-state-machine.service';

import { Conversation } from '../../src/conversations/entities/conversation.entity';
import { ConversationMessage } from '../../src/conversations/entities/conversation-message.entity';
import { Lead } from '../../src/leads/entities/lead.entity';
import { LeadActivity } from '../../src/leads/entities/lead-activity.entity';
import { Tenant } from '../../src/tenants/entities/tenant.entity';
import { Agent } from '../../src/agents/entities/agent.entity';
import { AgentConfig } from '../../src/agents/entities/agent-config.entity';

import {
  ConversationStage,
  ConversationStatus,
  LeadStatus,
} from '../../src/common/enums';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../src/common/types/queue-jobs.types';

// ─── Test DB config ───────────────────────────────────────────────────────────

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://salesagent:salesagent@localhost:5432/salesagent';

function buildTestModule(entities: Function[]) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: TEST_DATABASE_URL,
        entities,
        synchronize: false,
        logging: false,
      }),
      TypeOrmModule.forFeature(entities),
    ],
    providers: [
      ConversationsService,
      MessagesService,
      LeadsService,
      StageStateMachineService,
      // BullMQ queue stub — we don't want real queue operations in integration tests
      { provide: getQueueToken(QUEUE_NAMES.CRM_SYNC), useValue: { add: jest.fn() } },
    ],
  }).compile();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function seedTenantAndAgent(
  tenantRepo: Repository<Tenant>,
  agentRepo: Repository<Agent>,
): Promise<{ tenant: Tenant; agent: Agent }> {
  const tenant = await tenantRepo.save(
    tenantRepo.create({
      name: 'Integration Test Co',
      widgetKey: crypto.randomUUID(),
      plan: 'pro',
    }),
  );

  const agent = await agentRepo.save(
    agentRepo.create({
      tenantId: tenant.id,
      name: 'Test Agent',
      status: 'active',
    }),
  );

  return { tenant, agent };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('ConversationsService — Integration', () => {
  let module: TestingModule;
  let conversationsService: ConversationsService;
  let messagesService: MessagesService;
  let conversationRepo: Repository<Conversation>;
  let tenantRepo: Repository<Tenant>;
  let agentRepo: Repository<Agent>;
  let tenant: Tenant;
  let agent: Agent;

  beforeAll(async () => {
    module = await buildTestModule([
      Tenant, Agent, AgentConfig, Conversation, ConversationMessage,
      Lead, LeadActivity,
    ]);
    conversationsService = module.get(ConversationsService);
    messagesService = module.get(MessagesService);
    conversationRepo = module.get(getRepositoryToken(Conversation));
    tenantRepo = module.get(getRepositoryToken(Tenant));
    agentRepo = module.get(getRepositoryToken(Agent));

    ({ tenant, agent } = await seedTenantAndAgent(tenantRepo, agentRepo));
  });

  afterAll(async () => {
    // Clean up in FK-safe order
    await conversationRepo.delete({ tenantId: tenant.id });
    await agentRepo.delete({ tenantId: tenant.id });
    await tenantRepo.delete({ id: tenant.id });
    await module.close();
  });

  it('creates a conversation in GREETING stage', async () => {
    const conv = await conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: { pageUrl: 'https://example.com' },
    });

    expect(conv.id).toBeDefined();
    expect(conv.currentStage).toBe(ConversationStage.GREETING);
    expect(conv.status).toBe(ConversationStatus.ACTIVE);
    expect(conv.tenantId).toBe(tenant.id);
  });

  it('persists messages and retrieves them in order', async () => {
    const conv = await conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: {},
    });

    await messagesService.createMessage({
      conversationId: conv.id,
      tenantId: tenant.id,
      role: 'user',
      content: 'Hello, I need help with sales automation',
    });

    await messagesService.createMessage({
      conversationId: conv.id,
      tenantId: tenant.id,
      role: 'assistant',
      content: 'Hi! I\'d love to help. What\'s your current sales process?',
    });

    const history = await messagesService.getHistory(conv.id, tenant.id);

    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('transitions conversation stage from GREETING to DISCOVERY', async () => {
    const conv = await conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: {},
    });

    const updated = await conversationsService.updateStage(
      conv.id,
      tenant.id,
      ConversationStage.DISCOVERY,
    );

    expect(updated.currentStage).toBe(ConversationStage.DISCOVERY);

    // Verify persistence
    const fetched = await conversationRepo.findOne({ where: { id: conv.id } });
    expect(fetched?.currentStage).toBe(ConversationStage.DISCOVERY);
  });

  it('marks conversation as ENDED', async () => {
    const conv = await conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: {},
    });

    const ended = await conversationsService.end(conv.id, tenant.id);
    expect(ended.status).toBe(ConversationStatus.ENDED);
    expect(ended.endedAt).toBeDefined();
  });

  it('enforces tenant isolation — cannot fetch another tenant\'s conversation', async () => {
    const conv = await conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: {},
    });

    const result = await conversationRepo.findOne({
      where: { id: conv.id, tenantId: 'other-tenant-id' },
    });

    expect(result).toBeNull();
  });
});

// ─── Lead lifecycle ────────────────────────────────────────────────────────────

describe('LeadsService — Integration', () => {
  let module: TestingModule;
  let leadsService: LeadsService;
  let tenantRepo: Repository<Tenant>;
  let agentRepo: Repository<Agent>;
  let conversationRepo: Repository<Conversation>;
  let leadRepo: Repository<Lead>;
  let tenant: Tenant;
  let agent: Agent;

  beforeAll(async () => {
    module = await buildTestModule([
      Tenant, Agent, AgentConfig, Conversation, ConversationMessage,
      Lead, LeadActivity,
    ]);
    leadsService = module.get(LeadsService);
    tenantRepo = module.get(getRepositoryToken(Tenant));
    agentRepo = module.get(getRepositoryToken(Agent));
    conversationRepo = module.get(getRepositoryToken(Conversation));
    leadRepo = module.get(getRepositoryToken(Lead));

    ({ tenant, agent } = await seedTenantAndAgent(tenantRepo, agentRepo));
  });

  afterAll(async () => {
    await leadRepo.delete({ tenantId: tenant.id });
    await conversationRepo.delete({ tenantId: tenant.id });
    await agentRepo.delete({ tenantId: tenant.id });
    await tenantRepo.delete({ id: tenant.id });
    await module.close();
  });

  async function makeConversation(): Promise<Conversation> {
    const conversationsService = module.get(ConversationsService);
    return conversationsService.create({
      tenantId: tenant.id,
      agentId: agent.id,
      visitorId: crypto.randomUUID(),
      metadata: {},
    });
  }

  it('creates a new lead on first call', async () => {
    const conv = await makeConversation();
    const lead = await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-1',
      firstName: 'Jane',
      email: 'jane@integration-test.com',
    });

    expect(lead.id).toBeDefined();
    expect(lead.firstName).toBe('Jane');
    expect(lead.email).toBe('jane@integration-test.com');
    expect(lead.status).toBe(LeadStatus.CONTACTED); // auto-promoted because email provided
  });

  it('upserts idempotently — second call updates, not creates', async () => {
    const conv = await makeConversation();

    const first = await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-2',
      email: 'bob@integration-test.com',
    });

    const second = await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-2',
      firstName: 'Bob',
    });

    expect(second.id).toBe(first.id); // same record
    expect(second.email).toBe('bob@integration-test.com'); // original email preserved
    expect(second.firstName).toBe('Bob'); // new field merged in
  });

  it('merges BANT qualification data across multiple calls', async () => {
    const conv = await makeConversation();

    await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-3',
      qualificationPatch: { need: 'Scale outbound', needStrength: 'high' },
    });

    const updated = await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-3',
      qualificationPatch: { budget: '$50K/year', hasBudget: true },
    });

    // Both patches should coexist
    expect(updated.qualificationData.need).toBe('Scale outbound');
    expect(updated.qualificationData.needStrength).toBe('high');
    expect(updated.qualificationData.budget).toBe('$50K/year');
    expect(updated.qualificationData.hasBudget).toBe(true);
  });

  it('computes and persists the BANT score', async () => {
    const conv = await makeConversation();
    const lead = await leadsService.upsertByConversation({
      tenantId: tenant.id,
      conversationId: conv.id,
      visitorId: 'visitor-4',
      email: 'high-value@test.com',
      qualificationPatch: {
        hasBudget: true,
        budget: '$100K',
        isDecisionMaker: true,
        authority: 'CEO',
        needStrength: 'high',
        need: 'Automate all sales',
        hasTimeline: true,
        timeline: 'Q2 2026',
      },
    });

    expect(lead.score).toBe(100);
    expect(lead.status).toBe(LeadStatus.QUALIFIED); // 100 >= 50 threshold
  });
});
