// Global HTTP exception filter.
// Returns consistent error envelope: { statusCode, message, error, requestId, timestamp }
// Logs 5xx errors with request context.
export class HttpExceptionFilter {}
