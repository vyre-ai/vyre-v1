-- terminal: agents in Trash whose workspace volumes are kept (12 Nov). agent.deleted starts the clock, agent.restored ends it; the periodic pass removes the home and Files volumes once the agent has
-- been in Trash as long as the Space's Trash keeps things (governance's trash retention), the same rule the Space browser keeps for its profiles.
CREATE TABLE IF NOT EXISTS terminal_workspace_gone (
  agent_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
