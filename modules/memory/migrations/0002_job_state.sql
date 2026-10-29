-- memory: when the nightly job last ran, so a host that restarts all day still runs it about once a night.
CREATE TABLE IF NOT EXISTS memory_job_state (
  name TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
