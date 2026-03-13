// All WebSocket event name constants — single source of truth

export enum ClientEvents {
  // Visitor → Server
  CONVERSATION_START = 'conversation.start',
  MESSAGE_SEND = 'message.send',
  CONVERSATION_END = 'conversation.end',
}

export enum ServerEvents {
  // Server → Visitor
  MESSAGE_PROCESSING = 'message.processing',        // typing indicator
  MESSAGE_CHUNK = 'message.chunk',                  // streaming token
  MESSAGE_COMPLETE = 'message.complete',            // full response done
  STAGE_CHANGED = 'stage.changed',
  LEAD_CAPTURED = 'lead.captured',
  ERROR = 'error',

  // Tool execution progress (emitted to conversation room for rich client UX)
  TOOL_EXECUTION_STARTED = 'tool.execution.started',
  TOOL_EXECUTION_FINISHED = 'tool.execution.finished',

  // Holistic state snapshot after any meaningful state mutation
  STATE_UPDATED = 'state.updated',

  // Human handoff — emitted to visitor room so widget can show a message
  HANDOFF_TRIGGERED = 'handoff.triggered',

  // Server → Admin Dashboard
  LEAD_NEW = 'lead.new',
  HANDOFF_REQUESTED = 'handoff.requested',    // dashboard alert (existing)
  CONVERSATION_LIVE = 'conversation.live',
  NEGATIVE_COMMENT = 'social.negative_comment', // negative/critical social comment alert
}
