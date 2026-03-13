export enum WorkflowTrigger {
  CONVERSATION_ENDED = 'conversation_ended',
  LEAD_QUALIFIED = 'lead_qualified',
  DEMO_SCHEDULED = 'demo_scheduled',
  LEAD_LOST = 'lead_lost',
}

export enum WorkflowStepType {
  SEND_EMAIL = 'send_email',
  UPDATE_LEAD_STAGE = 'update_lead_stage',
  PUSH_TO_CRM = 'push_to_crm',
  WAIT = 'wait',     // delay in hours before next step
}

export interface WorkflowStep {
  type: WorkflowStepType;
  delayHours?: number;    // wait before this step executes
  config: Record<string, unknown>;  // step-specific config
}
