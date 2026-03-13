import { SkillRegistryService } from '../skill-registry.service';
import { ISkill, SkillContext, SkillResult } from '../../interfaces/skill.interface';

// Minimal stub skill for testing registration
function makeStubSkill(name: string): ISkill {
  return {
    name,
    description: `${name} stub`,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute(_args: unknown, _ctx: SkillContext): Promise<SkillResult> {
      return { success: true, data: `${name} executed` };
    },
  };
}

describe('SkillRegistryService', () => {
  let registry: SkillRegistryService;

  beforeEach(() => {
    registry = new SkillRegistryService();
    registry.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('registers all 9 built-in skills', () => {
      expect(registry.getAll()).toHaveLength(9);
    });

    it('registers every expected built-in skill name', () => {
      const names = registry.getAll().map((s) => s.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'AnswerQuestion',
          'CaptureContact',
          'QualifyLead',
          'RecommendService',
          'ScheduleDemo',
          'PushToCRM',
          'SendFollowUp',
          'HandoffToHuman',
          'TransitionStage',
        ]),
      );
    });
  });

  describe('register / deregister', () => {
    it('registers a new skill', () => {
      registry.register(makeStubSkill('CustomSkill'));
      expect(registry.getByName('CustomSkill')).toBeDefined();
    });

    it('overwrites an existing skill with the same name', () => {
      const original = makeStubSkill('AnswerQuestion');
      const replacement = { ...makeStubSkill('AnswerQuestion'), description: 'replaced' };
      registry.register(replacement);
      expect(registry.getByName('AnswerQuestion')?.description).toBe('replaced');
    });

    it('deregisters a skill', () => {
      registry.deregister('AnswerQuestion');
      expect(registry.getByName('AnswerQuestion')).toBeUndefined();
    });

    it('is a no-op when deregistering an unknown skill', () => {
      expect(() => registry.deregister('NonExistent')).not.toThrow();
    });
  });

  describe('getEnabled', () => {
    it('returns only the skills whose names are in the list', () => {
      const enabled = registry.getEnabled(['CaptureContact', 'QualifyLead']);
      expect(enabled).toHaveLength(2);
      expect(enabled.map((s) => s.name)).toEqual(
        expect.arrayContaining(['CaptureContact', 'QualifyLead']),
      );
    });

    it('silently skips unknown skill names', () => {
      const enabled = registry.getEnabled(['CaptureContact', 'NonExistent']);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('CaptureContact');
    });

    it('returns an empty array for an empty list', () => {
      expect(registry.getEnabled([])).toHaveLength(0);
    });
  });

  describe('toOpenAiTools', () => {
    it('formats skills as OpenAI tool definitions', () => {
      const skills = registry.getEnabled(['CaptureContact']);
      const tools = registry.toOpenAiTools(skills);

      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        type: 'function',
        function: {
          name: 'CaptureContact',
          description: expect.any(String),
          parameters: expect.objectContaining({ type: 'object' }),
        },
      });
    });

    it('returns an empty array for empty skill list', () => {
      expect(registry.toOpenAiTools([])).toHaveLength(0);
    });
  });
});
