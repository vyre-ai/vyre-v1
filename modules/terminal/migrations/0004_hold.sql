-- terminal: a person at the keyboard of a terminal (13 Nov). While a person holds a terminal the agent's commands and everyone else's keys are refused with "<name> has the keyboard"; the agent is told.
-- `seen` is the last time the holder typed or looked: a hold nobody uses for 15 minutes ends by itself, the same rule the Space browser keeps.
CREATE TABLE IF NOT EXISTS terminal_hold (
  terminal_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  since INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
