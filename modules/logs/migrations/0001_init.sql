-- logs module tables (P-L7b_01; ARCH 4.10 logs.db, 4.11 retention).
-- Every table is prefixed logs_ because ctx.db refuses any other name.
-- Rows hold ids and counts only. msg is a fixed template key; attrs is redacted JSON.

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
CREATE INDEX IF NOT EXISTS logs_row_behalf ON logs_row(on_behalf, at);
CREATE INDEX IF NOT EXISTS logs_row_cap ON logs_row(cap, at);
CREATE INDEX IF NOT EXISTS logs_row_run ON logs_row(run_id, at);
CREATE INDEX IF NOT EXISTS logs_row_entity ON logs_row(entity_id, at);
CREATE INDEX IF NOT EXISTS logs_row_place ON logs_row(place, at);
CREATE INDEX IF NOT EXISTS logs_row_at ON logs_row(at);

CREATE TABLE IF NOT EXISTS logs_span (
  space TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent TEXT,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  dur_us INTEGER NOT NULL,
  attrs TEXT,
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS logs_span_name ON logs_span(name, at);
CREATE INDEX IF NOT EXISTS logs_span_at ON logs_span(at);

-- One row per event, folded by the async consumer logs.events. Ids and times only, no payload.
CREATE TABLE IF NOT EXISTS logs_event (
  seq INTEGER PRIMARY KEY,
  trace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  entity TEXT
);
CREATE INDEX IF NOT EXISTS logs_event_trace ON logs_event(trace_id, seq);

-- Erase a person: rows keep the id, reads blank the actor.
CREATE TABLE IF NOT EXISTS logs_tombstone (
  actor TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_settings (
  space TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  full_days INTEGER NOT NULL,
  aggregate_days INTEGER NOT NULL
);

-- Rows older than full_days fold into one row per day, level, capability and result.
CREATE TABLE IF NOT EXISTS logs_aggregate (
  space TEXT NOT NULL,
  day INTEGER NOT NULL,
  level INTEGER NOT NULL,
  cap TEXT NOT NULL,
  result TEXT NOT NULL,
  n_rows INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL,
  dur_ms REAL NOT NULL,
  PRIMARY KEY (space, day, level, cap, result)
);

-- A hold blocks expiry while until_ms is empty or in the future.
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
  principal TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_export (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  principal TEXT NOT NULL,
  at INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  lines TEXT NOT NULL
);
