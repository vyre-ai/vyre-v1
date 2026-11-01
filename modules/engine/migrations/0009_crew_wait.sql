-- What the lead of a crew is waiting on that is not a teammate: the checks of a pull request, polled by the host (DESIGN-crew.md). One row per wait; the host's sweep looks at the pending ones, keeps the
-- progress up to date for the Crew tab, and when the checks end it posts one message in the lead's chat that wakes the lead.
CREATE TABLE IF NOT EXISTS engine_crew_wait (
  wait_id TEXT PRIMARY KEY,
  lead_thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  asker TEXT NOT NULL,
  kind TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS engine_crew_wait_state ON engine_crew_wait (state, started_at);
