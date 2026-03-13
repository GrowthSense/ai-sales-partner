import { CaptureContactSkill } from '../capture-contact.skill';
import { SkillContext } from '../../interfaces/skill.interface';

const ctx: SkillContext = {
  tenantId: 'tenant-1',
  conversationId: 'conv-1',
  agentId: 'agent-1',
  currentStage: 'discovery',
};

describe('CaptureContactSkill', () => {
  let skill: CaptureContactSkill;

  beforeEach(() => {
    skill = new CaptureContactSkill();
  });

  it('has the correct name for LLM function calling', () => {
    expect(skill.name).toBe('CaptureContact');
  });

  it('returns success with captured fields when valid data provided', async () => {
    const result = await skill.execute(
      { firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.com', company: 'Acme' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      captured: { firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.com', company: 'Acme' },
    });
  });

  it('triggers sendNotification when email is provided', async () => {
    const result = await skill.execute({ email: 'jane@acme.com' }, ctx);
    expect(result.sideEffects?.sendNotification).toBe(true);
  });

  it('triggers sendNotification when phone is provided', async () => {
    const result = await skill.execute({ phone: '+1-555-000-0001' }, ctx);
    expect(result.sideEffects?.sendNotification).toBe(true);
  });

  it('does NOT trigger sendNotification for name-only capture', async () => {
    const result = await skill.execute({ firstName: 'Jane' }, ctx);
    expect(result.sideEffects?.sendNotification).toBeFalsy();
  });

  it('sets updateLead side-effect with the provided contact data', async () => {
    const args = { firstName: 'Jane', email: 'jane@acme.com' };
    const result = await skill.execute(args, ctx);
    expect(result.sideEffects?.updateLead).toEqual(args);
  });

  it('strips undefined fields from the updateLead side-effect', async () => {
    const result = await skill.execute(
      { firstName: 'Jane', email: undefined },
      ctx,
    );
    // undefined email should not appear in captured
    expect((result.data as any).captured).not.toHaveProperty('email');
  });

  it('returns failure when no fields are provided', async () => {
    const result = await skill.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.data).toMatch(/no contact fields/i);
  });

  it('returns failure when all values are undefined', async () => {
    const result = await skill.execute(
      { firstName: undefined, email: undefined },
      ctx,
    );
    expect(result.success).toBe(false);
  });
});
