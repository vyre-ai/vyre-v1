-- The crew (DESIGN-crew.md): a project's repository on this computer, and one row per teammate job. A job is a teammate working in its own copy of the repository, on its own branch, in its own
-- thread under the lead's chat. The thread, its messages and its turns are the chat's and the engine's; this table only says which thread is a job, where it came from and how it stands.
CREATE TABLE IF NOT EXISTS engine_crew_repo (
  project_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  set_by TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS engine_crew_job (
  job_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  lead_thread_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  asker TEXT NOT NULL,
  title TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS engine_crew_job_lead ON engine_crew_job (lead_thread_id, started_at);
CREATE INDEX IF NOT EXISTS engine_crew_job_project ON engine_crew_job (project_id, started_at);
