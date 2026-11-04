-- Which tools an agent has used and how often, so the tools it reaches for most are listed at the start of its next turn without a tool_search (modules/engine/tool-use.ts). One row per agent and
-- tool; only tools that are not already listed for everyone are counted.
CREATE TABLE IF NOT EXISTS engine_tool_use (
  agent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, tool)
);
