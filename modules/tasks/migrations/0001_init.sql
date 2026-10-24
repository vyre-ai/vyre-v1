-- tasks: module tables, prefixed tasks_.
-- The task document lives in tasks_item.doc. tasks_meta is created by the generated schema, not here.

CREATE TABLE IF NOT EXISTS tasks_item (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  kind TEXT NOT NULL,
  assigned_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  due INTEGER,
  snoozed_until INTEGER,
  parent_task TEXT,
  source_kind TEXT,
  source_id TEXT,
  updated_at INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_item_updated ON tasks_item (updated_at);

CREATE INDEX IF NOT EXISTS tasks_item_parent ON tasks_item (parent_task);

CREATE INDEX IF NOT EXISTS tasks_item_source ON tasks_item (source_kind, source_id);

CREATE TABLE IF NOT EXISTS tasks_activity (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  by_id TEXT NOT NULL,
  note TEXT,
  event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_activity_task ON tasks_activity (task_id, at);

CREATE TABLE IF NOT EXISTS tasks_policy (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks_idem (
  idem_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks_delegate_chain (
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (from_kind, from_id)
);

CREATE TABLE IF NOT EXISTS tasks_source_grant (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  party_kind TEXT NOT NULL,
  party_id TEXT NOT NULL,
  allow INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id, party_kind, party_id)
);
