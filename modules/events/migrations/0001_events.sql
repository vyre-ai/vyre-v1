-- Events module tables (P-L6_10). Every table is named events_* (ctx.db guard, ARCH B2). The event log itself is the kernel's; these hold only webhooks, their delivery log and replay records.
-- Dates are unix milliseconds. event_types and filter are JSON text. secret is the sealed signing secret (ctx.seal JSON), never the clear value.

CREATE TABLE IF NOT EXISTS events_webhook (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  event_types TEXT NOT NULL,
  filter TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  secret TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_delivery_at INTEGER,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  gave_up_streak INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  deleted_at INTEGER
);

-- one row per delivery. kind 'event' is the automatic delivery of one event to one webhook (at most one per webhook and event); 'test' and 'replay' are manual and made once each.
-- body is the exact JSON text that was signed and sent, kept so a replay sends the same bytes with a fresh signature.
CREATE TABLE IF NOT EXISTS events_delivery (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'event',
  replay_of TEXT,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  last_error TEXT,
  at INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  next_attempt_at INTEGER,
  duration_ms INTEGER,
  body TEXT,
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS events_delivery_webhook ON events_delivery (webhook_id, at);
CREATE INDEX IF NOT EXISTS events_delivery_event ON events_delivery (webhook_id, event_id);

-- the replay records events.replay starts (the Run itself belongs to the runs module)
CREATE TABLE IF NOT EXISTS events_replay (
  run_id TEXT PRIMARY KEY,
  selector TEXT NOT NULL,
  from_seq INTEGER,
  to_seq INTEGER,
  event_count INTEGER NOT NULL,
  with_clearance INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- the highest event seq the webhooks_out consumer has looked at (lag = log head minus this)
CREATE TABLE IF NOT EXISTS events_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
