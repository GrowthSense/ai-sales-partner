// Per-tenant configuration overrides for built-in skills.
// Not all skills need a DB record — only those with configurable behaviour.
//
// Columns:
//   id         UUID PK
//   tenantId   UUID FK → tenants.id  NOT NULL
//   skillName  TEXT NOT NULL
//   config     JSONB   ← e.g. for ScheduleDemo: { provider:'calendly', eventTypeId }
//   isEnabled  BOOLEAN default true
//
// Indexes:
//   UNIQUE (tenantId, skillName)
export class SkillConfig {}
