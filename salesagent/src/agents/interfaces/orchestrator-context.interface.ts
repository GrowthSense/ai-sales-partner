import { ConversationStage } from '../../skills/interfaces/skill.interface';

export interface OrchestratorContext {
  tenantId: string;
  conversationId: string;
  agentId: string;
  leadId?: string;
  currentStage: ConversationStage;
  systemPrompt: string;
  messages: OpenAIMessage[];          // trimmed to token budget
  tools: OpenAITool[];                // enabled skills as function definitions
  llmConfig: LlmConfig;
}

export interface LlmConfig {
  model: string;                      // 'gpt-4o'
  temperature: number;                // 0.3
  maxTokens: number;                  // 4096
  streaming: boolean;                 // true
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
