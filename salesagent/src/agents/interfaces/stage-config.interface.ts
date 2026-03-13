import { ConversationStage } from '../../skills/interfaces/skill.interface';

// Stored as JSONB in Agent.stageConfig
// Provides per-stage custom instructions injected into the system prompt
export interface StageConfig {
  stages: {
    [K in ConversationStage]?: {
      instructions: string;       // appended to system prompt for this stage
      requiredSkills?: string[];  // must be called before transitioning out
      maxTurns?: number;          // soft limit before auto-advancing
    };
  };
}
