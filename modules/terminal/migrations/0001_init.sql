-- terminal: sessions, the commands run in them, each person's rules, and one-time attach tickets (spec 2.7, 2.23; ARCH 7.2).
-- Every table is terminal_*: ctx.db refuses anything else. A session is a tmux session on the host named in `host`; the row is what Vyre knows about it, tmux is the truth about its screen.

CREATE TABLE IF NOT EXISTS terminal_sessions (
  terminal_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  named INTEGER NOT NULL DEFAULT 0,
  host TEXT NOT NULL,
  host_title TEXT NOT NULL,
  agent_id TEXT,
  computer_id TEXT,
  device_id TEXT,
  cwd TEXT NOT NULL,
  state TEXT NOT NULL,
  exit_code INTEGER,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  owner TEXT NOT NULL,
  folder_id TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS terminal_sessions_owner ON terminal_sessions (owner, closed_at);
CREATE INDEX IF NOT EXISTS terminal_sessions_agent ON terminal_sessions (agent_id, host, closed_at);

-- What was run in a session, newest last. Never copied into events: the module's own record, so the chat block can say "Ran 3 commands".
CREATE TABLE IF NOT EXISTS terminal_commands (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  terminal_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER,
  by_principal TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_commands_terminal ON terminal_commands (terminal_id, seq);

-- allow, ask and deny entries and the extra folders, per person.
CREATE TABLE IF NOT EXISTS terminal_rules (
  person_id TEXT PRIMARY KEY,
  allow TEXT NOT NULL,
  ask TEXT NOT NULL,
  deny TEXT NOT NULL,
  folders TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- terminal.attach: a ticket the live relay spends once. Only its hash is kept.
CREATE TABLE IF NOT EXISTS terminal_tickets (
  ticket_hash TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
