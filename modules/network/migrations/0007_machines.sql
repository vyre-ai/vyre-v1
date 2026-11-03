-- Machines: the latest report of each computer that runs Vyre work, its limits, drain flag and pinned agents, and 30 days of history (one point a minute for a day, ten-minute points after).
CREATE TABLE IF NOT EXISTS network_machine (
  server_id TEXT PRIMARY KEY,
  nickname TEXT,
  max_turns INTEGER,
  max_pcs INTEGER,
  drain INTEGER NOT NULL DEFAULT 0,
  pins_json TEXT NOT NULL DEFAULT '[]',
  specs_json TEXT,
  load_json TEXT,
  run_json TEXT,
  can_json TEXT,
  latency_ms INTEGER,
  reported_at INTEGER
);
CREATE TABLE IF NOT EXISTS network_machine_point (
  server_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  step INTEGER NOT NULL,
  cpu REAL,
  mem REAL,
  disk REAL,
  net_in REAL,
  net_out REAL,
  vy_cpu REAL,
  vy_mem REAL,
  PRIMARY KEY (server_id, t)
);
-- an alert already sent to the Inbox, so it is sent once while it lasts
CREATE TABLE IF NOT EXISTS network_machine_alert (
  alert_id TEXT PRIMARY KEY,
  raised_at INTEGER NOT NULL
);
