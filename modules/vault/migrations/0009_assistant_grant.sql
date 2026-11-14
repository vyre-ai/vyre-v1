-- vault: "the Assistant may use item X inside Automation Y", given by a person who holds Use on X. The kernel carries the reach (an access share to the agent with the source through-agent:<giver>);
-- this table carries the scope (this Automation's runs and its build thread, for this giver) and is checked at every use. No value lives here.
CREATE TABLE IF NOT EXISTS vault_assistant_grant (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "automationName" TEXT,
  "threadId" TEXT,
  "agentId" TEXT NOT NULL,
  "giver" TEXT NOT NULL,
  "shareId" TEXT,
  "createdAt" INTEGER NOT NULL,
  "revokedAt" INTEGER,
  "revokedBy" TEXT,
  "revokedWhy" TEXT
);
CREATE INDEX IF NOT EXISTS vault_assistant_grant_item ON vault_assistant_grant ("itemId", "agentId");
CREATE INDEX IF NOT EXISTS vault_assistant_grant_auto ON vault_assistant_grant ("automationId");
