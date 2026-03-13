import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Lead } from '../../entities/lead.entity';
import { LeadActivity } from '../../entities/lead-activity.entity';
import { LeadsService, UpsertLeadDto } from '../leads.service';
import { LeadStatus, LeadSource } from '../../../common/enums';
import { QUEUE_NAMES } from '../../../common/types/queue-jobs.types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLeadRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  findOneOrFail: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockActivityRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
});

const mockQueue = () => ({
  add: jest.fn().mockResolvedValue({}),
});

function makeBaseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    visitorId: 'visitor-1',
    status: LeadStatus.NEW,
    source: LeadSource.WEBSITE_CHAT,
    score: 0,
    qualificationData: {
      budget: null,
      hasBudget: null,
      authority: null,
      isDecisionMaker: null,
      need: null,
      needStrength: null,
      timeline: null,
      hasTimeline: null,
      notes: null,
    },
    ...overrides,
  } as Lead;
}

// ─── computeScore unit tests (pure function — no DB) ─────────────────────────

describe('LeadsService.computeScore', () => {
  let service: LeadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: getRepositoryToken(Lead), useFactory: mockLeadRepo },
        { provide: getRepositoryToken(LeadActivity), useFactory: mockActivityRepo },
        { provide: getQueueToken(QUEUE_NAMES.CRM_SYNC), useFactory: mockQueue },
      ],
    }).compile();

    service = module.get(LeadsService);
  });

  it('returns 0 for a lead with no qualification data', () => {
    expect(service.computeScore(makeBaseLead())).toBe(0);
  });

  it('scores 0 when qualificationData is null', () => {
    const lead = makeBaseLead({ qualificationData: null as any });
    expect(service.computeScore(lead)).toBe(0);
  });

  // ── Budget (max 25) ────────────────────────────────────────────────────────

  it('awards 15 pts for hasBudget=true', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, hasBudget: true },
    });
    expect(service.computeScore(lead)).toBe(15);
  });

  it('awards 10 pts for budget text alone', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, budget: '$10K/year' },
    });
    expect(service.computeScore(lead)).toBe(10);
  });

  it('awards 25 pts for budget text + hasBudget=true', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, budget: '$10K', hasBudget: true },
    });
    expect(service.computeScore(lead)).toBe(25);
  });

  // ── Authority (max 25) ─────────────────────────────────────────────────────

  it('awards 15 pts for isDecisionMaker=true', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, isDecisionMaker: true },
    });
    expect(service.computeScore(lead)).toBe(15);
  });

  // ── Need (max 25) ──────────────────────────────────────────────────────────

  it('awards 5 pts for needStrength=low', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, needStrength: 'low' },
    });
    expect(service.computeScore(lead)).toBe(5);
  });

  it('awards 15 pts for needStrength=medium', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, needStrength: 'medium' },
    });
    expect(service.computeScore(lead)).toBe(15);
  });

  it('awards 25 pts for needStrength=high', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, needStrength: 'high' },
    });
    expect(service.computeScore(lead)).toBe(25);
  });

  it('awards 5 pts for need text with no strength rating', () => {
    const lead = makeBaseLead({
      qualificationData: { ...makeBaseLead().qualificationData, need: 'Cut costs' },
    });
    expect(service.computeScore(lead)).toBe(5);
  });

  // ── Timeline (max 25) ─────────────────────────────────────────────────────

  it('awards 25 pts for hasTimeline=true + timeline text', () => {
    const lead = makeBaseLead({
      qualificationData: {
        ...makeBaseLead().qualificationData,
        hasTimeline: true,
        timeline: 'Q3 2026',
      },
    });
    expect(service.computeScore(lead)).toBe(25);
  });

  // ── Full BANT ─────────────────────────────────────────────────────────────

  it('returns 100 for a fully-qualified lead', () => {
    const lead = makeBaseLead({
      qualificationData: {
        budget: '$50K/year',
        hasBudget: true,
        authority: 'VP of Sales',
        isDecisionMaker: true,
        need: 'Scale outbound',
        needStrength: 'high',
        timeline: 'Q3 2026',
        hasTimeline: true,
        notes: null,
      },
    });
    expect(service.computeScore(lead)).toBe(100);
  });

  it('never exceeds 100', () => {
    // Partial scores sum to 100 — adding extra shouldn't push past cap
    const lead = makeBaseLead({
      qualificationData: {
        budget: '$50K',
        hasBudget: true,
        authority: 'CEO',
        isDecisionMaker: true,
        need: 'Scale',
        needStrength: 'high',
        timeline: 'Next month',
        hasTimeline: true,
        notes: 'Also very urgent',
      },
    });
    expect(service.computeScore(lead)).toBe(100);
  });
});

// ─── upsertByConversation (mocked DB) ─────────────────────────────────────────

describe('LeadsService.upsertByConversation', () => {
  let service: LeadsService;
  let leadRepo: ReturnType<typeof mockLeadRepo>;
  let activityRepo: ReturnType<typeof mockActivityRepo>;

  const dto: UpsertLeadDto = {
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    visitorId: 'visitor-1',
    firstName: 'Jane',
    email: 'jane@acme.com',
  };

  beforeEach(async () => {
    leadRepo = mockLeadRepo();
    activityRepo = mockActivityRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: getRepositoryToken(Lead), useValue: leadRepo },
        { provide: getRepositoryToken(LeadActivity), useValue: activityRepo },
        { provide: getQueueToken(QUEUE_NAMES.CRM_SYNC), useFactory: mockQueue },
      ],
    }).compile();

    service = module.get(LeadsService);
  });

  it('creates a new lead when none exists for the conversation', async () => {
    const newLead = makeBaseLead({ firstName: 'Jane', email: 'jane@acme.com' });
    leadRepo.findOne.mockResolvedValue(null);
    leadRepo.create.mockReturnValue(newLead);
    leadRepo.save.mockResolvedValue({ ...newLead, id: 'lead-new' });
    activityRepo.create.mockReturnValue({});
    activityRepo.save.mockResolvedValue({});

    const result = await service.upsertByConversation(dto);

    expect(leadRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: dto.tenantId,
        conversationId: dto.conversationId,
        source: LeadSource.WEBSITE_CHAT,
        status: LeadStatus.NEW,
      }),
    );
    expect(result.id).toBe('lead-new');
  });

  it('promotes status to CONTACTED when email is provided on a NEW lead', async () => {
    const existing = makeBaseLead({ status: LeadStatus.NEW });
    leadRepo.findOne.mockResolvedValue(existing);
    leadRepo.save.mockImplementation(async (lead: Lead) => lead);
    activityRepo.create.mockReturnValue({});
    activityRepo.save.mockResolvedValue({});

    const result = await service.upsertByConversation(dto);
    expect(result.status).toBe(LeadStatus.CONTACTED);
  });

  it('promotes status to QUALIFIED when score reaches 50+', async () => {
    const existing = makeBaseLead({
      status: LeadStatus.CONTACTED,
      email: 'jane@acme.com',
      qualificationData: {
        budget: '$50K',
        hasBudget: true,
        authority: null,
        isDecisionMaker: null,
        need: 'Scale sales',
        needStrength: 'high',
        timeline: null,
        hasTimeline: null,
        notes: null,
      },
    });
    leadRepo.findOne.mockResolvedValue(existing);
    leadRepo.save.mockImplementation(async (lead: Lead) => lead);
    activityRepo.create.mockReturnValue({});
    activityRepo.save.mockResolvedValue({});

    const result = await service.upsertByConversation({
      ...dto,
      qualificationPatch: { hasBudget: true, budget: '$50K', needStrength: 'high', need: 'Scale' },
    });

    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.status).toBe(LeadStatus.QUALIFIED);
  });

  it('merges qualificationPatch without overwriting existing BANT fields', async () => {
    const existing = makeBaseLead({
      status: LeadStatus.CONTACTED,
      email: 'jane@acme.com',
      qualificationData: {
        budget: '$10K',
        hasBudget: true,
        authority: null,
        isDecisionMaker: null,
        need: null,
        needStrength: null,
        timeline: null,
        hasTimeline: null,
        notes: null,
      },
    });
    leadRepo.findOne.mockResolvedValue(existing);
    leadRepo.save.mockImplementation(async (lead: Lead) => lead);
    activityRepo.create.mockReturnValue({});
    activityRepo.save.mockResolvedValue({});

    const result = await service.upsertByConversation({
      ...dto,
      qualificationPatch: { need: 'Scale revenue', needStrength: 'high' },
    });

    // Original budget must survive the patch
    expect(result.qualificationData.budget).toBe('$10K');
    expect(result.qualificationData.hasBudget).toBe(true);
    expect(result.qualificationData.need).toBe('Scale revenue');
  });

  it('writes an activity record on create', async () => {
    const newLead = makeBaseLead();
    leadRepo.findOne.mockResolvedValue(null);
    leadRepo.create.mockReturnValue(newLead);
    leadRepo.save.mockResolvedValue({ ...newLead, id: 'lead-new' });
    activityRepo.create.mockReturnValue({ type: 'created' });
    activityRepo.save.mockResolvedValue({});

    await service.upsertByConversation(dto);

    expect(activityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'created' }),
    );
    expect(activityRepo.save).toHaveBeenCalled();
  });
});
