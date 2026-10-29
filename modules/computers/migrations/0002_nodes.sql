-- Agent computers on an enrolled computer (a node). A null node_id is the Space's own server. A job is one thing the Space asks a node to do for one computer; the node answers once and the answer is
-- stored, so a retry after a lost reply returns it and never runs the job again. The job's token is shown to the node once at delivery and kept only as a hash.
ALTER TABLE computers_computers ADD COLUMN node_id TEXT;

CREATE TABLE IF NOT EXISTS computers_job (
  job_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed')),
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  token_hash TEXT,
  deadline INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS computers_job_node ON computers_job (node_id, state);
