import { QualifyLeadSkill } from '../qualify-lead.skill';
import { SkillContext } from '../../interfaces/skill.interface';

const ctx: SkillContext = {
  tenantId: 'tenant-1',
  conversationId: 'conv-1',
  agentId: 'agent-1',
  currentStage: 'qualification',
};

describe('QualifyLeadSkill', () => {
  let skill: QualifyLeadSkill;

  beforeEach(() => {
    skill = new QualifyLeadSkill();
  });

  it('has the correct name', () => {
    expect(skill.name).toBe('QualifyLead');
  });

  it('returns success with all BANT fields', async () => {
    const args = {
      budget: '$10K–$50K/year',
      hasBudget: true,
      authority: 'VP of Engineering',
      isDecisionMaker: true,
      need: 'Reduce manual sales outreach',
      needStrength: 'high',
      timeline: 'Q3 2026',
      hasTimeline: true,
    };

    const result = await skill.execute(args, ctx);

    expect(result.success).toBe(true);
    expect(result.sideEffects?.updateLead).toEqual({ qualificationPatch: args });
    expect((result.data as any).qualified).toMatchObject({ budget: args.budget });
  });

  it('works with partial BANT data (incremental capture)', async () => {
    const result = await skill.execute({ need: 'Automate follow-ups', needStrength: 'medium' }, ctx);
    expect(result.success).toBe(true);
    expect(result.sideEffects?.updateLead).toEqual({
      qualificationPatch: { need: 'Automate follow-ups', needStrength: 'medium' },
    });
  });

  it('returns failure when no fields are provided', async () => {
    const result = await skill.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.data).toMatch(/no qualification fields/i);
  });

  it('does not include undefined fields in the side-effect patch', async () => {
    const result = await skill.execute(
      { need: 'Cut costs', budget: undefined },
      ctx,
    );

    expect(result.success).toBe(true);
    const patch = (result.sideEffects?.updateLead as any)?.qualificationPatch;
    expect(patch).toHaveProperty('need', 'Cut costs');
    expect(patch).not.toHaveProperty('budget');
  });

  it('has no pauseAgent or transitionStage side-effects', async () => {
    const result = await skill.execute({ need: 'Scale sales team' }, ctx);
    expect(result.sideEffects?.pauseAgent).toBeFalsy();
    expect(result.sideEffects?.transitionStage).toBeUndefined();
  });
});
