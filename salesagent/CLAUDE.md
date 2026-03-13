# CLAUDE.md — Agentic AI Sales Agent SaaS

This file captures architectural conventions, engineering decisions, and patterns that all contributors (human and AI) must follow when working in this codebase.

---

## Project Overview

A multi-tenant SaaS platform where companies deploy an AI sales agent on their website. The agent is **agentic** — it uses a structured reasoning loop (observe → reason → act → update state) powered by OpenAI GPT-4o with function calling, RAG-backed knowledge retrieval, and a skill framework to autonomously qualify leads, capture contacts, schedule demos, and push to CRM.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS (TypeScript) |
| ORM | TypeORM |
| Database | PostgreSQL 16 + pgvector extension |
| Queue | Redis + BullMQ |
| LLM | OpenAI GPT-4o (streaming) |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Realtime | Socket.io via `@nestjs/platform-socket.io` |
| Auth | JWT (access + refresh) |
| Architecture | Feature-based modules |

---

## Module Structure

Every module follows this exact layout — no exceptions:

```
src/<module>/
  controllers/        REST controllers (HTTP)
  services/           Business logic
  entities/           TypeORM entities
  dtos/               Request/response DTOs (class-validator)
  interfaces/         TypeScript interfaces and types
  <module>.module.ts  NestJS module definition
```

Gateways (WebSocket) live in `src/conversations/` since they are part of the conversations feature.

Workers (BullMQ processors) live in `src/<module>/workers/` inside the relevant module.

---

## The 12 Feature Modules

```
src/
  auth/           JWT auth, refresh tokens, widget session tokens
  users/          Tenant admin users
  tenants/        Tenant lifecycle, widget config, billing plan
  agents/         AI agent configuration per tenant
  conversations/  Conversation + message lifecycle, WebSocket gateway
  leads/          Lead profiles, qualification scores, CRM sync
  skills/         Skill registry and executor (internal only)
  tools/          Stateless tool implementations (calendar, CRM, email)
  mcp/            MCP server registration and tool proxy
  rag/            Embedding, retrieval, reranking (internal only)
  knowledge/      Knowledge base documents and chunk ingestion
  workflows/      Automated follow-up sequences
```

---

## Multi-Tenancy — CRITICAL RULES

**Strategy: Row-level isolation with `tenantId` FK on every table.**

1. Every entity (except `Tenant` itself) MUST have a `tenantId: string` column.
2. Every database query MUST include `WHERE tenant_id = :tenantId` — no exceptions.
3. The `tenantId` is always sourced from the authenticated JWT claim, never from the request body.
4. PostgreSQL RLS policies are applied as a secondary defense layer.
5. All repository methods accept `tenantId` as a required parameter.

Violation of these rules = cross-tenant data leak = critical security incident.

---

## Agent Orchestration

The central entry point is `AgentOrchestrator` in `src/agents/services/agent-orchestrator.service.ts`.

### Reasoning Loop

```
AgentOrchestrator.run(conversationId, userMessage)
  1. OBSERVE  — load history, lead profile, current stage
  2. REASON   — RAG retrieval + OpenAI call with skill tool definitions
  3. ACT      — execute skills if tool_call returned (max 3 iterations)
  4. UPDATE   — persist messages, update stage, upsert lead, emit WS events
```

### Conversation Stages (ordered)

```
greeting → discovery → qualification → recommendation
  → objection_handling ↔ recommendation
  → conversion → scheduling → follow_up
```

Stage transitions are ALWAYS validated by `StageStateMachine` — the LLM signals a transition via `TransitionStage` skill but cannot bypass the state machine.

---

## Skills Framework

Skills are atomic capabilities the agent can invoke via OpenAI function calling.

### Built-in Skills

| Skill | Purpose |
|---|---|
| `AnswerQuestion` | RAG-powered answer from knowledge base |
| `QualifyLead` | Extract BANT fields |
| `CaptureContact` | Extract name/email/phone, upsert Lead |
| `RecommendService` | Match visitor needs to service catalog |
| `ScheduleDemo` | Calendly/Cal.com booking |
| `PushToCRM` | HubSpot/Salesforce sync (async via queue) |
| `SendFollowUpEmail` | Queue follow-up sequence |
| `HandoffToHuman` | Pause AI, alert dashboard |
| `TransitionStage` | Signal stage change (validated server-side) |

### Adding a New Skill

1. Create class implementing `ISkill` interface (`src/skills/interfaces/skill.interface.ts`)
2. Register it in `SkillRegistryService.onModuleInit()`
3. Add skill name to `ConversationStage` config JSONB for agents that should use it
4. Write an integration test in `src/skills/skills.spec.ts`

---

## RAG Architecture

### Ingestion Pipeline

```
Document upload → BullMQ rag-ingest job → parse → chunk (512 tok, 100 overlap)
  → embed (text-embedding-3-small) → store KnowledgeChunk with vector → HNSW index
```

### Retrieval (every agent turn)

```
User message → embed → hybrid search (semantic + keyword, tenantId filtered)
  → reciprocal rank fusion → top-10 → rerank → top-5 → inject as <context>
```

### pgvector Index

```sql
CREATE INDEX ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);
```

**Always filter by `tenant_id` BEFORE applying the vector similarity operator** to prevent cross-tenant leakage and to leverage the composite index.

---

## BullMQ Queues

| Queue name | Purpose | Concurrency |
|---|---|---|
| `agent-response` | Async agent fallback (WS disconnected) | 10 |
| `rag-ingest` | Document chunking + embedding | 5 |
| `crm-sync` | CRM push (HubSpot / Salesforce) | 3 |
| `follow-up` | Delayed follow-up emails | 3 |
| `notifications` | Tenant webhook delivery | 5 |

All jobs must include `tenantId` in their payload. Workers validate `tenantId` before processing.

---

## WebSocket Events

### Client → Server

| Event | Payload |
|---|---|
| `conversation.start` | `{ agentId, metadata }` |
| `message.send` | `{ conversationId, content }` |
| `conversation.end` | `{ conversationId }` |

### Server → Client

| Event | Payload |
|---|---|
| `message.processing` | `{ conversationId }` (typing indicator) |
| `message.chunk` | `{ conversationId, token }` (streaming) |
| `message.complete` | `{ conversationId, messageId, stage }` |
| `stage.changed` | `{ conversationId, from, to }` |
| `lead.captured` | `{ conversationId, leadId }` |

### Tenant Dashboard (server → admin)

| Event | Room | Payload |
|---|---|---|
| `lead.new` | `tenant:<id>:leads` | Lead summary |
| `handoff.requested` | `tenant:<id>:handoffs` | Conversation summary |

---

## Testing Approach

**Rule: Integration tests hit a real PostgreSQL + Redis instance. No mocks for database or queue.**

- Use `@testcontainers/postgresql` and `@testcontainers/redis` for CI
- Unit tests only for pure functions (token counting, chunking logic, RRF scoring)
- E2E tests use `supertest` for REST and `socket.io-client` for WebSocket flows
- Each test seeds its own tenant/agent/user and cleans up after

**Why:** We were burned by mock-DB tests passing while prod migrations failed. Real DB tests catch schema issues early.

---

## Environment Variables

See `.env.example` for the full list. Required at runtime:

```
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/salesagent
DATABASE_SSL=false

# Redis
REDIS_URL=redis://localhost:6379

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# JWT
JWT_ACCESS_SECRET=<32+ char secret>
JWT_REFRESH_SECRET=<32+ char secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Encryption (for MCP server credentials)
ENCRYPTION_KEY=<32-byte hex>

# CRM integrations (optional)
HUBSPOT_API_KEY=
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=

# Calendar (optional)
CALENDLY_API_KEY=
CALCOM_API_KEY=
```

---

## Token Budget (GPT-4o, 128K context)

| Slot | Budget | Notes |
|---|---|---|
| System prompt | ~2K | Persona + stage + lead summary |
| RAG context | ~3K | 5 chunks × ~600 tokens |
| Conversation history | up to 80K | Rolling window, oldest trimmed first |
| Response (maxTokens) | 4K | Hard cap |
| Safety buffer | ~39K | Never fill completely |

**Rule:** The system prompt and the most recent 20 messages are NEVER trimmed. Trim from the oldest messages backward.

---

## Key Engineering Decisions

| Decision | Choice | Reason |
|---|---|---|
| Multi-tenancy | Row-level isolation + RLS | Scales to 1000s of tenants without schema sprawl |
| Skill selection | OpenAI function calling | No extra classifier round-trip; reliable + fast |
| Vector index | HNSW (pgvector) | No retraining needed; better accuracy for growing data |
| Embedding model | text-embedding-3-small | 5x cheaper; ~3% quality gap acceptable for sales RAG |
| Retrieval | Hybrid (semantic + BM25) | Exact-match queries (product names, SKUs) fail pure semantic |
| Streaming | OpenAI stream → WS tokens | Real-time UX; no polling |
| Async work | BullMQ named queues | Reliable retries, observable, separate scaling |
| MCP security | Server-side proxy + AES-256 | Credentials never leave server; tenant isolation enforced |
| Stage management | LLM signals + server validates | LLM decides intent; server enforces correctness |
| Token trimming | Rolling window, persona preserved | Agent identity remains consistent throughout conversation |

---

## MCP Integration

- MCP server credentials are encrypted at rest (AES-256-GCM, key from `ENCRYPTION_KEY` env var)
- MCP tool calls have a 10s timeout and 50KB response cap
- Tool schemas are re-synced on registration + daily cron
- If an MCP server is unreachable, its tools are silently removed from the active skill list for that conversation

---

## Folder Naming Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Services: `<Name>Service` (e.g., `AgentOrchestratorService`)
- Entities: `<Name>` (e.g., `Conversation`, `KnowledgeChunk`)
- DTOs: `Create<Name>Dto`, `Update<Name>Dto`, `<Name>ResponseDto`
- Interfaces: `I<Name>` (e.g., `ISkill`, `ISkillResult`)
- Enums: `<Name>` with `SCREAMING_SNAKE_CASE` values or descriptive string literals

---

## Running Locally

```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Run migrations
npm run migration:run

# 4. Start dev server
npm run start:dev

# 5. Run tests
npm run test:integration
```
