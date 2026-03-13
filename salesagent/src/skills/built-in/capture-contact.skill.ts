import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

/**
 * CaptureContactSkill
 *
 * Extracts visitor contact information from the conversation and persists it
 * to the Lead record. Called when the visitor provides their name, email, phone,
 * company, or job title.
 *
 * Side-effects tell the orchestrator to upsert the Lead with the captured fields.
 */
export class CaptureContactSkill implements ISkill {
  readonly name = 'CaptureContact';
  readonly description =
    'Extract and save the visitor\'s contact information (name, email, phone, company, job title). ' +
    'Call this as soon as the visitor provides any identifying information. ' +
    'Only include fields the visitor has explicitly shared — never guess or infer.';

  readonly parameters = {
    type: 'object',
    properties: {
      firstName: { type: 'string', description: 'Visitor\'s first name.' },
      lastName: { type: 'string', description: 'Visitor\'s last name.' },
      email: { type: 'string', format: 'email', description: 'Visitor\'s email address.' },
      phone: { type: 'string', description: 'Visitor\'s phone number (any format).' },
      company: { type: 'string', description: 'Company or organisation name.' },
      jobTitle: { type: 'string', description: 'Visitor\'s job title or role.' },
    },
    required: [],
    additionalProperties: false,
  };

  async execute(
    args: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      company?: string;
      jobTitle?: string;
    },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    const captured = Object.entries(args).filter(([, v]) => v !== undefined);

    if (captured.length === 0) {
      return { success: false, data: 'No contact fields provided.' };
    }

    return {
      success: true,
      data: { captured: Object.fromEntries(captured) },
      sideEffects: {
        updateLead: args,
        sendNotification: !!(args.email || args.phone), // ping dashboard on first contact capture
      },
    };
  }
}
