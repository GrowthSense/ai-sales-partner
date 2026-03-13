import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';
import { ConversationStage } from '../../common/enums';

/**
 * TransitionStageSkill
 *
 * Signals to the orchestrator that the conversation should advance to a new stage.
 * The orchestrator validates the request against the StageStateMachine before
 * applying it — the LLM cannot bypass the allowed transition graph.
 */
export class TransitionStageSkill implements ISkill {
  readonly name = 'TransitionStage';
  readonly description =
    'Signal that the conversation is ready to move to a new stage. ' +
    'The transition will be validated against the allowed stage graph. ' +
    'Use this when you have completed the goals of the current stage.';

  readonly parameters = {
    type: 'object',
    properties: {
      targetStage: {
        type: 'string',
        enum: Object.values(ConversationStage),
        description: 'The stage to transition to.',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of why the conversation is ready for this stage.',
      },
    },
    required: ['targetStage'],
    additionalProperties: false,
  };

  async execute(
    args: { targetStage: ConversationStage; reason?: string },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    return {
      success: true,
      data: { requested: args.targetStage, reason: args.reason ?? 'stage advancement' },
      sideEffects: {
        transitionStage: args.targetStage,
      },
    };
  }
}
