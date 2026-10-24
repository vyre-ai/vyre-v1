-- logs: module tables, prefixed logs_. Structured rows only (ARCH 4.10). msg is a template key. attrs is ids and counts.
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
CREATE INDEX IF NOT EXISTS logs_row_entity ON logs_row(entity_id, at);
CREATE INDEX IF NOT EXISTS logs_row_run ON logs_row(run_id, at);
CREATE INDEX IF NOT EXISTS logs_row_place ON logs_row(place, at);

CREATE TABLE IF NOT EXISTS logs_span (
  id INTEGER PRIMARY KEY,
  space TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent TEXT,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  dur_us INTEGER NOT NULL,
  attrs TEXT
);
CREATE INDEX IF NOT EXISTS logs_span_trace ON logs_span(trace_id);

CREATE TABLE IF NOT EXISTS logs_event (
  id INTEGER PRIMARY KEY,
  space TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  entity TEXT
);
CREATE INDEX IF NOT EXISTS logs_event_trace ON logs_event(trace_id);

CREATE TABLE IF NOT EXISTS logs_tombstone (
  space TEXT NOT NULL,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (space, actor)
);

CREATE TABLE IF NOT EXISTS logs_setting (
  space TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  full_days INTEGER NOT NULL,
  aggregate_days INTEGER NOT NULL
);

-- Daily counts after the full window. No msg, attrs, or actor.
CREATE TABLE IF NOT EXISTS logs_agg (
  day INTEGER NOT NULL,
  space TEXT NOT NULL,
  cap TEXT NOT NULL,
  result TEXT NOT NULL,
  n INTEGER NOT NULL,
  dur_ms REAL NOT NULL,
  cost_micros INTEGER NOT NULL,
  PRIMARY KEY (day, space, cap, result)
);

CREATE TABLE IF NOT EXISTS logs_replay (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  state TEXT NOT NULL,
  recorded_outward INTEGER NOT NULL,
  steps TEXT NOT NULL,
  at_seq INTEGER NOT NULL,
  run_id TEXT,
  conflict_id TEXT
);

CREATE TABLE IF NOT EXISTS logs_stream (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_export (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
