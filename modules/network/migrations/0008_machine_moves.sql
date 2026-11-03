-- Machines: where Automatic moved a turn off a busy machine (the Space-wide Recent moves list), and which machines were busy at the last look (so a machine filling up or freeing up is told once).
CREATE TABLE IF NOT EXISTS network_machine_move (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  turn_id TEXT,
  asker TEXT,
  agent_id TEXT,
  thread_id TEXT,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  why TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS network_machine_busy (
  server_id TEXT PRIMARY KEY,
  since INTEGER NOT NULL
);
