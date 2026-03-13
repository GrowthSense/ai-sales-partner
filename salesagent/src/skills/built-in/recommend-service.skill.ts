import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

export class RecommendServiceSkill implements ISkill {
  readonly name = 'RecommendService';
  readonly description =
    'Record that a specific product or service was recommended to the visitor, ' +
    'along with the primary reason tied to their stated pain point. ' +
    'Call after each recommendation so it is tracked in the lead record.';

  readonly parameters = {
    type: 'object',
    properties: {
      serviceName: { type: 'string', description: 'Name of the product or service.' },
      reason: { type: 'string', description: 'Why this was recommended based on visitor needs.' },
      pricingTier: { type: 'string', description: 'Pricing tier if mentioned, e.g. "Pro".' },
    },
    required: ['serviceName', 'reason'],
    additionalProperties: false,
  };

  async execute(
    args: { serviceName: string; reason: string; pricingTier?: string },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    return {
      success: true,
      data: { recommended: args.serviceName, reason: args.reason },
      sideEffects: {
        updateLead: { qualificationPatch: { notes: `Recommended: ${args.serviceName} — ${args.reason}` } },
      },
    };
  }
}
