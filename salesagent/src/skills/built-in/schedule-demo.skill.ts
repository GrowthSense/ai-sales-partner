import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

export class ScheduleDemoSkill implements ISkill {
  readonly name = 'ScheduleDemo';
  readonly description =
    'Provide a scheduling link or initiate a demo booking. ' +
    'Call this when the visitor agrees to book a demo or discovery call. ' +
    'Passes the visitor\'s name and email to pre-fill the booking form.';

  readonly parameters = {
    type: 'object',
    properties: {
      meetingType: {
        type: 'string',
        enum: ['demo', 'discovery_call', 'follow_up'],
        description: 'Type of meeting to schedule.',
      },
      preferredTime: {
        type: 'string',
        description: "Visitor's stated preferred time, e.g. \"Tuesday afternoon\".",
      },
      visitorName: {
        type: 'string',
        description: "Visitor's name to pre-fill the booking form.",
      },
      visitorEmail: {
        type: 'string',
        description: "Visitor's email to pre-fill the booking form.",
      },
    },
    required: ['meetingType'],
    additionalProperties: false,
  };

  async execute(
    args: {
      meetingType: string;
      preferredTime?: string;
      visitorName?: string;
      visitorEmail?: string;
    },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    if (!ctx.services) {
      // Fallback for unit tests without services wired
      return {
        success: true,
        data: {
          bookingLink: 'https://demo.salesagent.dev/book/demo',
          meetingType: args.meetingType,
        },
        sideEffects: { transitionStage: 'scheduling' },
      };
    }

    try {
      const bookingLink = await ctx.services.invokeIntegration<string>(
        'calendar',
        'getBookingLink',
        {
          name: args.visitorName,
          email: args.visitorEmail,
          preferredDate: args.preferredTime,
        },
      );

      return {
        success: true,
        data: {
          bookingLink,
          meetingType: args.meetingType,
          message: 'Here is your personalised booking link.',
        },
        sideEffects: {
          transitionStage: 'scheduling',
          sendNotification: true,
        },
      };
    } catch {
      return {
        success: false,
        data: {
          error: 'Unable to generate booking link. Please try again or contact support.',
        },
      };
    }
  }
}
