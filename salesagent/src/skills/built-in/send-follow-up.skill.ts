import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

export class SendFollowUpSkill implements ISkill {
  readonly name = 'SendFollowUpEmail';
  readonly description =
    'Queue a follow-up email sequence for the visitor after the conversation ends. ' +
    'Call this when the visitor leaves without booking, or at the end of a productive conversation.';

  readonly parameters = {
    type: 'object',
    properties: {
      sequenceType: {
        type: 'string',
        enum: ['post_conversation', 'demo_reminder', 'nurture'],
        description: 'Which email sequence to trigger.',
      },
      delayHours: {
        type: 'number',
        description: 'Hours to wait before sending the first email. Default: 2.',
      },
    },
    required: ['sequenceType'],
    additionalProperties: false,
  };

  async execute(
    args: { sequenceType: string; delayHours?: number },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    return {
      success: true,
      data: {
        status: 'follow_up_enqueued',
        sequenceType: args.sequenceType,
        delayHours: args.delayHours ?? 2,
      },
    };
  }
}
