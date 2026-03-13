import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

/**
 * QualifyLeadSkill
 *
 * Captures BANT qualification signals extracted from the conversation.
 * Call this incrementally as the visitor reveals information — do not wait
 * until all four BANT fields are available.
 */
export class QualifyLeadSkill implements ISkill {
  readonly name = 'QualifyLead';
  readonly description =
    'Record BANT qualification information the visitor has shared: ' +
    'budget range, whether they are the decision maker, their specific need/pain, ' +
    'and their timeline. Call incrementally — do not wait for all fields. ' +
    'Only record information the visitor has explicitly stated.';

  readonly parameters = {
    type: 'object',
    properties: {
      budget: { type: 'string', description: 'Budget range, e.g. "$10K–$50K/year".' },
      hasBudget: { type: 'boolean', description: 'True if they have an approved budget.' },
      authority: { type: 'string', description: 'Who makes the buying decision, e.g. "VP of Engineering".' },
      isDecisionMaker: { type: 'boolean', description: 'True if the visitor is the decision maker.' },
      need: { type: 'string', description: 'Main pain point or problem they want to solve.' },
      needStrength: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How urgent their need is based on what they said.',
      },
      timeline: { type: 'string', description: 'When they want a solution, e.g. "Q3 2026".' },
      hasTimeline: { type: 'boolean', description: 'True if they have a specific timeline.' },
      notes: { type: 'string', description: 'Any other relevant qualification notes.' },
    },
    required: [],
    additionalProperties: false,
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    const fields = Object.entries(args).filter(([, v]) => v !== undefined);
    if (fields.length === 0) {
      return { success: false, data: 'No qualification fields provided.' };
    }

    return {
      success: true,
      data: { qualified: Object.fromEntries(fields) },
      sideEffects: {
        updateLead: { qualificationPatch: args },
      },
    };
  }
}
