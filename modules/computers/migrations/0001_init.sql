-- computers: one sealed container per agent (spec 2.7; ARCH 6.6, 7.2). The rows say what the host last reported and who holds the controls; the container itself is the host's.
-- Every table is computers_*: ctx.db refuses anything else.

CREATE TABLE IF NOT EXISTS computers_computers (
  computer_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('provisioning', 'asleep', 'waking', 'working', 'takeover', 'error')),
  caption TEXT,
  tabs INTEGER NOT NULL DEFAULT 0,
  tab_limit INTEGER NOT NULL,
  idle_sleep_minutes INTEGER NOT NULL,
  host TEXT NOT NULL CHECK (host IN ('server', 'vm')),
  disk_bytes INTEGER,
  last_frame_at INTEGER,
  last_frame_file TEXT,
  last_active_at INTEGER,
  takeover_by TEXT,
  takeover_step TEXT,
  takeover_at INTEGER,
  recording_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);

-- A recording made while a person has the controls. folder_path is under the agent's Files folder; the files in it are written by the host after the module has masked them.
CREATE TABLE IF NOT EXISTS computers_recordings (
  recording_id TEXT PRIMARY KEY,
  computer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER,
  folder_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('recording', 'saved', 'processed')),
  intents TEXT NOT NULL,
  by_person TEXT NOT NULL,
  task_id TEXT
);
CREATE INDEX IF NOT EXISTS computers_recordings_computer ON computers_recordings (computer_id, started_at);

-- One-use tickets: a take over (the viewer's connection to the desktop) and a stream (the live view). Only the hash is kept.
CREATE TABLE IF NOT EXISTS computers_tickets (
  ticket_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- A frame per step: what the agent did (or the person, when they took over). Other computers handlers add steps with addStep.
CREATE TABLE IF NOT EXISTS computers_timeline (
  step_id TEXT PRIMARY KEY,
  computer_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  at INTEGER NOT NULL,
  by_who TEXT NOT NULL CHECK (by_who IN ('agent', 'person')),
  caption TEXT NOT NULL,
  tool TEXT NOT NULL,
  frame_file_id TEXT,
  run_id TEXT,
  thread_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS computers_timeline_idx ON computers_timeline (computer_id, idx);

-- Signed-in sites on the profile disk as last read from the running computer, so the list is there while it sleeps.
CREATE TABLE IF NOT EXISTS computers_sessions (
  computer_id TEXT NOT NULL,
  site TEXT NOT NULL,
  signed_in_as TEXT,
  since INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (computer_id, site)
);
