-- terminal: background jobs that went into a crash loop and were stopped by their supervisor, and who was told (rc.44), so the owner is told once per job and the pass that looks every minute does not tell them again.
CREATE TABLE IF NOT EXISTS terminal_job_loops (
  agent_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, job_id)
)
