-- A person paused an agent's Space browser (sbrowser/pause.ts): the agent's next browser call waits here until they resume it, so nothing is spent while it waits. The table is the one truth, so a pause
-- outlives a restart of the browser service. `since` ends it by itself after PAUSE_MAX_MS: a pause nobody came back to never holds the agent for good.
CREATE TABLE IF NOT EXISTS computers_browser_pause (
  profile_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  since INTEGER NOT NULL
);
