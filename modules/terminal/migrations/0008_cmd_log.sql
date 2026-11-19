-- The retained output of a command (lane r42-computer, lead's rules of 19 Nov): what a terminal command printed, scrubbed before it is stored (the Vault's scrubber, so a Vault value never reaches disk), kept so an
-- agent or a person can read part of it later (tail, grep, a range of lines) instead of the whole. One row per command, keyed by the command's own number in terminal_commands. Capped per command and per agent,
-- dropped 7 days after the command ended, and erased with the agent. It lives in the Space's data, never in a cache.
CREATE TABLE IF NOT EXISTS terminal_cmd_log (
  seq INTEGER PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  cut_bytes INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_cmd_log_terminal ON terminal_cmd_log (terminal_id, seq);
CREATE INDEX IF NOT EXISTS terminal_cmd_log_agent ON terminal_cmd_log (agent_id, ended_at);
