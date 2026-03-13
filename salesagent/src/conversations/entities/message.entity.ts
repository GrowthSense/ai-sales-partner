// Columns:
//   id               UUID PK
//   conversationId   UUID FK → conversations.id  NOT NULL
//   role             TEXT (user | assistant | tool)
//   content          TEXT NOT NULL
//   toolCalls        JSONB NULL  ← raw OpenAI tool_calls array when role=assistant
//   toolCallId       TEXT NULL   ← OpenAI tool_call_id when role=tool
//   toolName         TEXT NULL   ← skill name when role=tool
//   tokenCount       INT
//   createdAt        TIMESTAMP
//
// Indexes:
//   (conversationId, createdAt ASC)   ← history fetch (hot path)
export class Message {}
