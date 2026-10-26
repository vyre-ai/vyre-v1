-- conflicts: parked collisions, the assistant's proposal, resolutions with their Undo values, and the history of merge losers (ARCH 5.5; spec 4.11).
-- Every table is conflicts_*: ctx.db refuses anything else. The first block matches generated/modules/conflicts/schema.sql exactly, so either CREATE can run first.

CREATE TABLE IF NOT EXISTS "conflicts_conflict" (
  "id" TEXT PRIMARY KEY,
  "entity" TEXT,
  "recordId" TEXT,
  "field" TEXT,
  "ours" TEXT,
  "theirs" TEXT,
  "base" TEXT,
  "state" TEXT,
  "plainChoice" INTEGER,
  "summary" TEXT,
  "openedAt" INTEGER,
  "person" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "conflicts_conflict__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "conflicts_conflict__owner" ON "conflicts_conflict" ("person");

-- What the entity table has no column for. One row per conflict. op_id and field make a retried push land on the same conflict.
CREATE TABLE IF NOT EXISTS conflicts_detail (
  conflict_id TEXT PRIMARY KEY,
  op_id TEXT NOT NULL,
  field TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'field' CHECK (kind IN ('field', 'binary')),
  protected INTEGER NOT NULL DEFAULT 0,
  ours_actor TEXT,
  theirs_actor TEXT,
  device_id TEXT,
  trace_id TEXT,
  base_seq INTEGER,
  proposal TEXT,
  task_id TEXT,
  run_id TEXT,
  UNIQUE (op_id, field)
);

-- One row per resolution. prev_value is what the field held before it was applied, which is what Undo puts back.
CREATE TABLE IF NOT EXISTS conflicts_resolution (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  resolution_id TEXT NOT NULL UNIQUE,
  conflict_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('ours', 'theirs', 'merged', 'custom')),
  summary TEXT NOT NULL,
  by_actor TEXT NOT NULL,
  at INTEGER NOT NULL,
  prev_value TEXT,
  new_value TEXT,
  applied INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('active', 'undone'))
);
CREATE INDEX IF NOT EXISTS conflicts_resolution_by_conflict ON conflicts_resolution (conflict_id, n);

-- Values that lost a merge or were replaced by a resolution. Idempotent per (entity, record, field, hlc, actor).
CREATE TABLE IF NOT EXISTS conflicts_history (
  entity TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field TEXT NOT NULL,
  hlc TEXT NOT NULL,
  actor TEXT NOT NULL,
  value TEXT,
  seq INTEGER,
  reason TEXT NOT NULL CHECK (reason IN ('lww_loser', 'resolved', 'superseded')),
  at INTEGER NOT NULL,
  PRIMARY KEY (entity, record_id, field, hlc, actor)
);
