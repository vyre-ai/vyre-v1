-- Delete for good (F77): the ids the job needs after the stores that knew them are cleared (the agent's one-to-one chats, its routines), so the event log and the request cache are cleared of them last.
CREATE TABLE IF NOT EXISTS "agents_erase_ids" (
  "agentId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  PRIMARY KEY ("agentId", "id")
);
