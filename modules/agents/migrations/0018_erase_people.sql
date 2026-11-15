-- Delete for good (F77): the people who lose something when an agent is erased (their own chat with it, their own folder on its computer), read before the stores are cleared, so each is told when it is erased.
CREATE TABLE IF NOT EXISTS "agents_erase_people" (
  "agentId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  PRIMARY KEY ("agentId", "personId")
);
