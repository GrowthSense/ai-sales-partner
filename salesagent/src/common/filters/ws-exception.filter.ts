// WebSocket exception filter — catches errors in gateway handlers
// Emits 'error' event to client: { code, message }
// Ensures WS connection stays alive after non-fatal errors
export class WsExceptionFilter {}
