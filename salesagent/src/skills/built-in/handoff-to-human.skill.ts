import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

/**
 * HandoffToHumanSkill
 *
 * Pauses the AI agent and alerts a human agent to take over.
 * Triggers: visitor requests human, agent cannot resolve objection,
 * conversation enters crisis, or PAUSED status is set.
 */
export class HandoffToHumanSkill implements ISkill {
  readonly name = 'HandoffToHuman';
  readonly description =
    'Pause AI responses and alert a human sales agent to take over this conversation. ' +
    'Use when: the visitor explicitly asks for a human, you cannot resolve an objection, ' +
    'the visitor expresses strong frustration, or the topic is outside your knowledge.';

  readonly parameters = {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why the handoff is being requested.',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How urgently a human agent should respond.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  };

  async execute(
    args: { reason: string; urgency?: string },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    return {
      success: true,
      data: {
        message: 'Connecting you with a human agent. Please hold on.',
        reason: args.reason,
        urgency: args.urgency ?? 'medium',
      },
      sideEffects: {
        pauseAgent: true,
        transitionStage: 'follow_up' as never,
        sendNotification: true,
      },
    };
  }
}
