-- Hooks (lane l-hooks). One row per hook, the helper links that let a run's hooks reach its helpers, the Space switch, and a short log of what ran.
-- Every statement is one CREATE: projections.ts runs the same list one by one when a table is missing, so a test ctx and the daemon end up with the same schema.

CREATE TABLE IF NOT EXISTS "hooks_hook" (
  "id" TEXT PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "person_id" TEXT,
  "agent_id" TEXT,
  "thread_id" TEXT,
  "ended_at" INTEGER,
  "helpers" INTEGER NOT NULL DEFAULT 1,
  "event" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "matcher" TEXT NOT NULL DEFAULT '',
  "spec" TEXT NOT NULL,
  "timeout_sec" INTEGER NOT NULL DEFAULT 20,
  "paused" INTEGER NOT NULL DEFAULT 0,
  "line" TEXT NOT NULL,
  "made_by" TEXT NOT NULL,
  "made_by_kind" TEXT NOT NULL,
  "for_person" TEXT,
  "seq" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "removed_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "hooks_link" (
  "helper_thread" TEXT PRIMARY KEY,
  "parent_thread" TEXT NOT NULL,
  "done" INTEGER NOT NULL DEFAULT 0,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "hooks_policy" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "hooks_run" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "hook_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "thread_id" TEXT,
  "agent_id" TEXT,
  "tool" TEXT,
  "targets" TEXT,
  "outcome" TEXT NOT NULL,
  "detail" TEXT,
  "ms" INTEGER NOT NULL DEFAULT 0,
  "at" INTEGER NOT NULL
);

-- One person's "run once anyway": the next time this hook would stop something in this chat it lets it through, and the pass is used up. Ten minutes at most.
CREATE TABLE IF NOT EXISTS "hooks_pass" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "hook_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "by" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "used_at" INTEGER
);

-- "Always allow": this hook lets this kind of act go by from now on, in its own scope. It keeps guarding everything else. Added by a person who may change the hook; an admin can remove it.
CREATE TABLE IF NOT EXISTS "hooks_allow" (
  "id" TEXT PRIMARY KEY,
  "hook_id" TEXT NOT NULL,
  "tool" TEXT NOT NULL,
  "target" TEXT NOT NULL DEFAULT '',
  "by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "removed_at" INTEGER
);

-- A note for the agent's next turn in a chat: the person denied a stop, so it stands.
CREATE TABLE IF NOT EXISTS "hooks_note" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "thread_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "used_at" INTEGER,
  "at" INTEGER NOT NULL
);
