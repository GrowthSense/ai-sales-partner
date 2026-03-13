// Schema returned by MCP server's GET /tools endpoint
export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;   // JSON Schema
}

export interface McpCallRequest {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  tenantId: string;
}
