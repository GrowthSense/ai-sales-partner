import { SkillExecutorService } from '../skill-executor.service';
import { SkillRegistryService } from '../skill-registry.service';
import { ISkill, SkillContext, SkillResult } from '../../interfaces/skill.interface';
import { LlmToolCall } from '../../../llm/dto/llm.dto';

const ctx: SkillContext = {
  tenantId: 'tenant-1',
  conversationId: 'conv-1',
  agentId: 'agent-1',
  currentStage: 'discovery',
};

function makeToolCall(name: string, args: Record<string, unknown> = {}, id = 'call-1'): LlmToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('SkillExecutorService', () => {
  let registry: SkillRegistryService;
  let executor: SkillExecutorService;

  beforeEach(() => {
    registry = new SkillRegistryService();
    registry.onModuleInit();
    executor = new SkillExecutorService(registry);
  });

  describe('execute — happy path', () => {
    it('executes CaptureContact and returns success', async () => {
      const toolCall = makeToolCall('CaptureContact', {
        firstName: 'Jane',
        email: 'jane@acme.com',
      });

      const { result, record } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(true);
      expect(record.skillName).toBe('CaptureContact');
      expect(record.success).toBe(true);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('executes QualifyLead and returns side-effects', async () => {
      const toolCall = makeToolCall('QualifyLead', {
        need: 'Reduce churn',
        needStrength: 'high',
      });

      const { result } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(true);
      expect(result.sideEffects?.updateLead).toBeDefined();
    });
  });

  describe('execute — error handling', () => {
    it('returns failure (not throws) when skill name is unknown', async () => {
      const toolCall = makeToolCall('UnknownSkill', {});
      const { result, record } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(false);
      expect(result.data).toMatch(/unknown skill/i);
      expect(record.success).toBe(false);
    });

    it('returns failure when arguments JSON is malformed', async () => {
      const toolCall: LlmToolCall = {
        id: 'call-2',
        type: 'function',
        function: { name: 'CaptureContact', arguments: '{not valid json' },
      };

      const { result } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(false);
      expect(result.data).toMatch(/invalid json/i);
    });

    it('returns failure when a required field is missing', async () => {
      // AnswerQuestion requires `query`
      const toolCall = makeToolCall('AnswerQuestion', {}); // missing query
      const { result } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(false);
      expect(result.data).toMatch(/missing required fields/i);
    });

    it('returns failure (not throws) when skill.execute throws internally', async () => {
      const explodingSkill: ISkill = {
        name: 'ExplodingSkill',
        description: 'Always throws',
        parameters: { type: 'object', properties: {}, required: [] },
        async execute(): Promise<SkillResult> {
          throw new Error('boom');
        },
      };
      registry.register(explodingSkill);

      const toolCall = makeToolCall('ExplodingSkill', {});
      const { result } = await executor.execute(toolCall, ctx);

      expect(result.success).toBe(false);
      expect(result.data).toMatch(/boom/i);
    });

    it('handles empty arguments object gracefully', async () => {
      // QualifyLead has no required fields — empty args returns "no fields" failure
      const toolCall = makeToolCall('QualifyLead', {});
      const { result } = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('executeAll', () => {
    it('executes multiple tool calls in parallel and preserves order', async () => {
      const toolCalls = [
        makeToolCall('CaptureContact', { firstName: 'Jane' }, 'call-a'),
        makeToolCall('QualifyLead', { need: 'Cost reduction' }, 'call-b'),
      ];

      const results = await executor.executeAll(toolCalls, ctx);

      expect(results).toHaveLength(2);
      expect(results[0].toolCallId).toBe('call-a');
      expect(results[0].toolName).toBe('CaptureContact');
      expect(results[1].toolCallId).toBe('call-b');
      expect(results[1].toolName).toBe('QualifyLead');
    });

    it('returns individual failures without aborting the batch', async () => {
      const toolCalls = [
        makeToolCall('UnknownSkill', {}, 'bad-call'),
        makeToolCall('CaptureContact', { email: 'x@y.com' }, 'good-call'),
      ];

      const results = await executor.executeAll(toolCalls, ctx);

      expect(results[0].result.success).toBe(false);
      expect(results[1].result.success).toBe(true);
    });
  });
});
