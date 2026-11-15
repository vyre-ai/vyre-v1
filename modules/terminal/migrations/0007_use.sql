-- terminal: when a person lost the use of an agent they had a place on (the clock of the 30 days their home is kept), and which chats have a shared folder on which agent's computer (so a person who left a chat
-- can have their entries taken off it). Made on first use like the earlier ones.
CREATE TABLE IF NOT EXISTS terminal_use_lost (
  agent_id TEXT NOT NULL,
  person TEXT NOT NULL,
  lost_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, person)
);
CREATE TABLE IF NOT EXISTS terminal_chat_folders (
  agent_id TEXT NOT NULL,
  thread TEXT NOT NULL,
  PRIMARY KEY (agent_id, thread)
)
