-- engine: durable rows of the turn engine and of AI spend and incidents (ARCH 6.1, 6.2, 6.7; spec 4.14, 3.10).
-- Every table is engine_*: ctx.db refuses anything else. A second host that takes a thread over (recover) reads these rows, so a message body,
-- a queued turn or a parked tool call written by the first host is still there.

CREATE TABLE IF NOT EXISTS engine_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  thread_seq INTEGER NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  mentions TEXT NOT NULL,
  depth INTEGER NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_messages_seq ON engine_messages (thread_id, thread_seq);

CREATE TABLE IF NOT EXISTS engine_thread_queue (
  thread_id TEXT NOT NULL,
  qseq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message_id TEXT,
  agent_id TEXT NOT NULL,
  from_principal TEXT NOT NULL,
  priority INTEGER NOT NULL,
  state TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  routine INTEGER NOT NULL,
  steer INTEGER NOT NULL,
  PRIMARY KEY (thread_id, qseq)
);
CREATE INDEX IF NOT EXISTS engine_thread_queue_state ON engine_thread_queue (thread_id, state, priority);

CREATE TABLE IF NOT EXISTS engine_thread_lease (
  thread_id TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  turn_id TEXT
);

-- A turn parked on a held tool call (turn.waiting { task }); removed when the wake that continues it starts.
CREATE TABLE IF NOT EXISTS engine_waits (
  task_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  asker TEXT NOT NULL,
  run_id TEXT,
  at INTEGER NOT NULL,
  resolution TEXT,
  wake_qseq INTEGER
);
CREATE INDEX IF NOT EXISTS engine_waits_thread ON engine_waits (thread_id);

-- Mode, model and engine of an agent in a thread, so a reopened thread keeps what Set mode, Set model and Switch chose.
CREATE TABLE IF NOT EXISTS engine_agent_state (
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  mode TEXT,
  model TEXT,
  provider TEXT,
  effort TEXT,
  account_ref TEXT,
  engine TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);

-- Spend caps by scope ('space' | 'person' | 'agent'); scope_id is '' for the Space. caps is the JSON of the contract's caps object.
CREATE TABLE IF NOT EXISTS engine_spend_caps (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  caps TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_id)
);

CREATE TABLE IF NOT EXISTS engine_spend_state (
  id TEXT PRIMARY KEY,
  paused INTEGER NOT NULL,
  paused_by TEXT,
  reason TEXT,
  at INTEGER NOT NULL
);

-- One row per turn: what it used, for whom, on which agent. record_usage adds to it as the turn runs.
CREATE TABLE IF NOT EXISTS engine_usage (
  turn_id TEXT PRIMARY KEY,
  thread_id TEXT,
  agent_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  model TEXT NOT NULL,
  at INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_usage_at ON engine_usage (at);

-- "Raise once": extra headroom on one limit for the current period (a day, or a month for the month limit).
CREATE TABLE IF NOT EXISTS engine_raises (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  limit_kind TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  by_principal TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_raises_key ON engine_raises (scope, scope_id, limit_kind, period);

-- The Needs you card of a limit hit, one per scope, limit and period, so a turn that keeps going over does not stack cards.
CREATE TABLE IF NOT EXISTS engine_limit_cards (
  card_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_incidents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  owner_id TEXT,
  agent_id TEXT,
  turn_id TEXT,
  opened_by TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS engine_incidents_state ON engine_incidents (state, opened_at);

CREATE TABLE IF NOT EXISTS engine_incident_notes (
  incident_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  by_principal TEXT NOT NULL,
  at INTEGER NOT NULL,
  note_text TEXT NOT NULL,
  PRIMARY KEY (incident_id, n)
);
