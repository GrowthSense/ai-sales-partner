// Data attached to Socket.io client after authentication.
// Stored in client.data and accessed throughout the gateway lifecycle.

export interface VisitorClientData {
  visitorId: string;
  tenantId: string;
  widgetKey: string;
  conversationId?: string;   // set after conversation.start
}

export interface AdminClientData {
  userId: string;
  tenantId: string;
  role: string;
}
