-- vault: Space AI accounts (owner ruling 9). A shared provider row an owner or admin keeps for the Space: what it may pay for (uses, JSON: teamChats, automations, goals, agentWork), an optional
-- monthly spend cap in cents, and the models its provider last listed, so a turn can tell whether the account serves its model without asking the provider. No value lives here; the item holds it.
CREATE TABLE IF NOT EXISTS vault_provider_uses (
  "providerId" TEXT PRIMARY KEY,
  "uses" TEXT NOT NULL DEFAULT '{}',
  "capCents" INTEGER,
  "models" TEXT NOT NULL DEFAULT '[]',
  "setBy" TEXT NOT NULL,
  "setAt" INTEGER NOT NULL
);
