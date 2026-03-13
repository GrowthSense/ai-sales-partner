import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

export class PushToCrmSkill implements ISkill {
  readonly name = 'PushToCRM';
  readonly description =
    'Trigger a sync of the current lead record to the connected CRM (HubSpot, Salesforce). ' +
    'Call this after capturing contact info or after a demo is booked.';

  readonly parameters = {
    type: 'object',
    properties: {
      priority: {
        type: 'string',
        enum: ['normal', 'high'],
        description: 'Sync priority. Use "high" for hot leads (demo booked).',
      },
    },
    required: [],
    additionalProperties: false,
  };

  async execute(_args: Record<string, unknown>, _ctx: SkillContext): Promise<SkillResult> {
    // Actual sync is handled by LeadsService.enqueueCrmSync() — the orchestrator
    // calls that at the end of every turn for leads with email captured.
    return {
      success: true,
      data: { status: 'crm_sync_enqueued' },
    };
  }
}
