-- logs.db (ARCH 4.10, 4.11). Tables are prefixed logs_ so ctx.db accepts them.
-- Rows hold ids and counts only. msg is a template key. attrs is redacted JSON.
-- Retention: logs_row, logs_span and logs_event stay for full_days (default 30);
-- logs_aggregate stays for aggregate_days (default 180). Holds in logs_hold block expiry.

CREATE TABLE IF NOT EXISTS logs_row (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  level INTEGER NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  space TEXT NOT NULL,
  actor TEXT,
  on_behalf TEXT,
  run_id TEXT,
  thread_id TEXT,
  device TEXT,
  place TEXT,
  cap TEXT,
  entity TEXT,
  entity_id TEXT,
  result TEXT,
  dur_ms REAL,
  cost_micros INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  label INTEGER,
  app_version TEXT,
  server_version TEXT,
  machine TEXT,
  msg TEXT NOT NULL,
  attrs TEXT
);
CREATE INDEX IF NOT EXISTS logs_row_trace ON logs_row(trace_id);
CREATE INDEX IF NOT EXISTS logs_row_actor ON logs_row(actor, at);
CREATE INDEX IF NOT EXISTS logs_row_cap ON logs_row(cap, at);
CREATE INDEX IF NOT EXISTS logs_row_run ON logs_row(run_id, at);
CREATE INDEX IF NOT EXISTS logs_row_entity ON logs_row(entity_id, at);
CREATE INDEX IF NOT EXISTS logs_row_place ON logs_row(place, at);

CREATE TABLE IF NOT EXISTS logs_span (
  space TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent TEXT,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  dur_us INTEGER NOT NULL,
  attrs TEXT,
  PRIMARY KEY (space, trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS logs_span_trace ON logs_span(trace_id);

CREATE TABLE IF NOT EXISTS logs_event (
  space TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  entity TEXT,
  PRIMARY KEY (space, trace_id, seq)
);
CREATE INDEX IF NOT EXISTS logs_event_trace ON logs_event(trace_id, seq);

CREATE TABLE IF NOT EXISTS logs_tombstone (
  actor TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_health (
  space TEXT NOT NULL,
  check_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  latency_ms REAL,
  detail TEXT,
  PRIMARY KEY (space, check_key, at)
);

CREATE TABLE IF NOT EXISTS logs_settings (
  space TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  full_days INTEGER NOT NULL,
  aggregate_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_aggregate (
  id INTEGER PRIMARY KEY,
  space TEXT NOT NULL,
  day INTEGER NOT NULL,
  cap TEXT,
  result TEXT,
  level INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL,
  dur_ms REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_aggregate_day ON logs_aggregate(space, day);

CREATE TABLE IF NOT EXISTS logs_hold (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  until_ms INTEGER
);

CREATE TABLE IF NOT EXISTS logs_replay (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  at_seq INTEGER NOT NULL,
  run_id TEXT,
  conflict_id TEXT,
  state TEXT NOT NULL,
  recorded_outward INTEGER NOT NULL,
  steps TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_stream (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  filter TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_export (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  at INTEGER NOT NULL,
  rows_json TEXT NOT NULL
);
