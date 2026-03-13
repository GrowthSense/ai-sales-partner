# Salesagent — Agentic AI Sales SaaS

Multi-tenant SaaS platform that embeds an autonomous AI sales agent on customer websites. The agent qualifies leads, captures contacts, recommends services, schedules demos, pushes to CRM, and follows up — all via a structured reasoning loop over OpenAI function calling.

**Stack:** NestJS · TypeScript · PostgreSQL + pgvector · Redis/BullMQ · OpenAI · Socket.io

---

## Quickstart (Local Development)

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- An OpenAI API key

### 1. Clone and install

```bash
git clone <repo>
cd salesagent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set:
#   OPENAI_API_KEY
#   JWT_ACCESS_SECRET   (32+ random chars)
#   JWT_REFRESH_SECRET  (32+ random chars, different from above)
#   JWT_WIDGET_SECRET   (32+ random chars)
#   ENCRYPTION_KEY      (64 hex chars — see .env.example for generation command)
```

### 3. Start infrastructure and run

```bash
./scripts/dev.sh
```

This starts PostgreSQL + Redis in Docker, runs pending migrations, and starts NestJS in watch mode.

Or, to run everything in Docker (including the app):

```bash
./scripts/dev.sh --docker
```

### 4. Verify

```
GET http://localhost:3000/health
```

---

## Scripts

| Script | Description |
|---|---|
| `./scripts/dev.sh` | Start infra + app with hot reload |
| `./scripts/dev.sh --docker` | Start everything in Docker |
| `./scripts/migrate.sh run` | Apply pending migrations |
| `./scripts/migrate.sh revert` | Revert last migration |
| `./scripts/migrate.sh generate <Name>` | Generate migration from entity diff |
| `./scripts/prod.sh build` | Build production Docker image |
| `./scripts/prod.sh up` | Start production compose stack |
| `./scripts/prod.sh migrate` | Run migrations in production |
| `./scripts/prod.sh logs [service]` | Tail logs |

---

## Architecture Overview

```
Visitor Widget (embedded JS)
        │ WSS + HTTPS
        ▼
NestJS Application (horizontally scalable)
  ├── REST Controllers (auth, tenants, agents, leads, knowledge, ...)
  ├── WebSocket Gateway (Socket.io — real-time streaming to visitor)
  └── BullMQ Workers (CRM sync, RAG ingest, follow-up emails)
        │
        ▼
Agent Orchestration Layer
  AgentOrchestrator → ReasoningEngine → SkillRegistry
  StageStateMachine → MemoryManagerService → PromptBuilderService
        │
   ┌────┴────┐
   ▼         ▼
PostgreSQL  Redis
+ pgvector  BullMQ queues
            WS pub/sub
        │
        ▼
OpenAI API  (chat completions + embeddings)
CRM / Calendar APIs (via ToolServices)
MCP Servers (tenant-registered external tools)
```

### Agent Reasoning Loop

Each user message triggers:

1. **Observe** — Load conversation history (token-budget trimmed), lead profile, current stage
2. **Retrieve** — Hybrid semantic + keyword search against tenant knowledge base (pgvector HNSW + pg_trgm)
3. **Reason** — Build system prompt (persona + stage + lead + RAG context), call OpenAI with skill definitions as function tools
4. **Act** — Execute any tool calls (skills), feed results back to LLM
5. **Update** — Persist messages, transition conversation stage, upsert lead, emit WebSocket events

### Conversation Stages

`greeting → discovery → qualification → recommendation → objection_handling → conversion → scheduling → follow_up`

Stage transitions are signalled by the LLM via `TransitionStage` tool call, then validated by `StageStateMachine` before being applied.

---

## Module Structure

```
src/
├── agents/          Agent config, orchestrator, skills framework, prompt building
├── auth/            JWT issuance, refresh, widget session tokens
├── analytics/       Daily snapshots, event aggregation
├── common/          Guards, decorators, enums, base entities
├── config/          Environment validation schema
├── conversations/   Conversation + message lifecycle, WebSocket gateway
├── integrations/    CRM (HubSpot, Salesforce), Calendar (Cal.com, Calendly)
├── knowledge/       Document upload, chunking, ingestion pipeline
├── leads/           Lead profiles, BANT qualification, scoring
├── mcp/             MCP server registry, tool proxy
├── rag/             Embedding, hybrid retrieval, reranking
├── skills/          Built-in skill implementations + registry
├── tenants/         Tenant lifecycle, widget config, plan management
├── tools/           Low-level tool clients (CRM API, calendar API, email)
├── users/           Tenant admin users, roles
├── websocket/       Socket.io gateway, room management, WS auth
└── workflows/       Automated follow-up sequences, BullMQ workers
```

---

## Database

### Multi-tenancy

Row-level isolation: every table carries a non-nullable `tenant_id` UUID column. TypeORM global scopes inject `WHERE tenant_id = :tid` automatically. PostgreSQL Row Security Policies (RLS) provide a DB-level safety net.

### pgvector

The `knowledge_chunks` table stores 1536-dimension embeddings (OpenAI `text-embedding-3-small`). An HNSW index provides fast approximate nearest-neighbour search:

```sql
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Always pre-filter by `tenant_id`** before the vector similarity operation to prevent cross-tenant data leakage.

### Migrations

```bash
# Apply all pending migrations
./scripts/migrate.sh run

# Generate a new migration after changing entities
./scripts/migrate.sh generate AddSomethingToLeads

# Revert the last migration
./scripts/migrate.sh revert
```

Migrations live in `src/migrations/`. The `data-source.ts` file configures the TypeORM CLI data source.

---

## Environment Variables

See `.env.example` for the full reference. Required variables that have no default:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `OPENAI_API_KEY` | OpenAI API key (must start with `sk-`) |
| `JWT_ACCESS_SECRET` | Access token signing secret (32+ chars) |
| `JWT_REFRESH_SECRET` | Refresh token signing secret (32+ chars, unique) |
| `JWT_WIDGET_SECRET` | Widget session signing secret (32+ chars) |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM (MCP credentials) |

Generate the encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Production Deployment

### Docker

```bash
# Build and start the production stack
./scripts/prod.sh build
./scripts/prod.sh migrate   # Run migrations first
./scripts/prod.sh up

# Tail app logs
./scripts/prod.sh logs app
```

The production compose file (`docker-compose.prod.yml`) runs 2 app replicas with resource limits. For managed databases (RDS, ElastiCache), set `DATABASE_URL` and `REDIS_URL` to your managed service URLs and remove the `postgres`/`redis` services from the compose file.

### Scaling

- **App replicas**: The NestJS app is stateless. Scale horizontally with `docker compose --scale app=N` or via your orchestrator (ECS, Kubernetes).
- **WebSocket fan-out**: Multiple app instances share state via Redis pub/sub — Socket.io is configured with the Redis adapter.
- **BullMQ workers**: The worker processes can be scaled independently from the API server.

---

## Testing

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:cov

# Integration tests (requires running postgres + redis)
npm run test:integration

# E2E tests
npm run test:e2e
```

Integration tests hit a real database — no mocking the DB layer. See `CLAUDE.md` for the full testing conventions.

---

## BullMQ Queues

| Queue | Purpose |
|---|---|
| `agent-response` | Trigger agent reasoning loop (async fallback when WS disconnected) |
| `rag-ingest` | Chunk + embed knowledge documents |
| `crm-sync` | Push lead data to HubSpot / Salesforce |
| `follow-up` | Delayed follow-up emails (BullMQ delayed jobs) |
| `notifications` | Webhook delivery to tenant endpoints |
