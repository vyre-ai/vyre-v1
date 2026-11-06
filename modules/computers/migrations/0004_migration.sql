-- The one-time move of an existing agent computer to a workspace and a Space browser profile (migrate.ts). One row per computer; `done` rows are never touched again.
CREATE TABLE IF NOT EXISTS computers_migration (
  computer_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done', 'partial', 'failed')),
  workspace_id TEXT,
  profile_id TEXT,
  chrome_bytes INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  at INTEGER NOT NULL
);
