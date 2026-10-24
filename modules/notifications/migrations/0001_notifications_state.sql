-- Notifications tables (P-L6_08, spec 2.24).
-- notifications_items and its field-merge table match generated/modules/notifications/schema.sql exactly, so either CREATE runs first.
-- notifications_rules: one row per person; hours_mode is default (the manifest setting), custom (working_hours holds the JSON) or off (always on).
-- notifications_mutes: one row per person and target; until is the end of the mute. notifications_away: one row per person while away.
-- notifications_delegates: the standing approvals chain. notifications_push: one token per device (sealed when the host has a seal).
-- notifications_agent_interrupts: one row per interrupt an agent was allowed, for the 3 an hour cap. notifications_backstops: the email backstop is sent once per key.

-- entity notification
CREATE TABLE IF NOT EXISTS "notifications_items" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "kind" TEXT,
  "level" TEXT,
  "place" TEXT,
  "title" TEXT,
  "body" TEXT,
  "subject_type" TEXT,
  "subject_id" TEXT,
  "collapse_key" TEXT,
  "count" REAL,
  "at" INTEGER,
  "seen_at" INTEGER,
  "actions" TEXT,
  "run_id" TEXT,
  "trace_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "notifications_items__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "notifications_items__owner" ON "notifications_items" ("person");

CREATE TABLE IF NOT EXISTS "notifications_rules" (
  "person" TEXT PRIMARY KEY,
  "hours_mode" TEXT NOT NULL DEFAULT 'default',
  "working_hours" TEXT,
  "email_backstop" INTEGER NOT NULL DEFAULT 1,
  "muted_agents" TEXT NOT NULL DEFAULT '[]',
  "muted_channels" TEXT NOT NULL DEFAULT '[]',
  "muted_records" TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS "notifications_mutes" (
  "person" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "until" INTEGER NOT NULL,
  PRIMARY KEY ("person", "target_kind", "target_id")
);
CREATE TABLE IF NOT EXISTS "notifications_away" (
  "person" TEXT PRIMARY KEY,
  "until" INTEGER NOT NULL,
  "delegate" TEXT NOT NULL,
  "since" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "notifications_delegates" (
  "person" TEXT PRIMARY KEY,
  "chain" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "notifications_push" (
  "device" TEXT PRIMARY KEY,
  "person" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "registered_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "notifications_push__person" ON "notifications_push" ("person");
CREATE TABLE IF NOT EXISTS "notifications_agent_interrupts" (
  "person" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "notifications_agent_interrupts__who" ON "notifications_agent_interrupts" ("person", "agent", "at");
CREATE TABLE IF NOT EXISTS "notifications_backstops" (
  "key" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "notifications_items__collapse" ON "notifications_items" ("person", "collapse_key");
