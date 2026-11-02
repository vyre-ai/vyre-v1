-- The setup grant of an outside agent (owner ruling 3 Nov, docs/ask-the-person.md): "Act for me, including setup". One row per agent; setup 1 means its person-only and role-gated calls in the
-- setup scope run as its person without a card, the person's role checked on every call. Given by its person at Allow or in Settings, taken back there or in the Console. Never by an agent.
CREATE TABLE IF NOT EXISTS mcp_setup_grants (
  agent_id TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  setup INTEGER NOT NULL,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL
);
