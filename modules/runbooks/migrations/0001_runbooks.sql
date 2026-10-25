-- runbooks: what Vyre keeps about a runbook. The runbook itself is a markdown file in module files; the shell happens in a terminal session of module terminal.
-- runbooks_target is the saved Runs on bar of a file (metadata, not file bytes, so it adds no version).
-- A run is one row; its blocks are one row each; the output of a block is kept as ordered chunks (run logs).

CREATE TABLE IF NOT EXISTS runbooks_target (
  file_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  computer_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runbooks_run (
  run_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  by_principal TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  computer_id TEXT,
  terminal_id TEXT,
  at INTEGER NOT NULL,
  duration_ms INTEGER,
  state TEXT NOT NULL,
  exit_code INTEGER,
  all_blocks INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS runbooks_run__file ON runbooks_run (file_id);

CREATE TABLE IF NOT EXISTS runbooks_block (
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  exit_code INTEGER,
  ms INTEGER,
  state TEXT NOT NULL,
  PRIMARY KEY (run_id, block_id)
);

CREATE TABLE IF NOT EXISTS runbooks_output (
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
