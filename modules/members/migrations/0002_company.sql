-- Connect your company: where the one flow stands. One row. Everything else it shows is read live from the connector, the sign-in policy and the Vault, so it survives a restart and never asks twice.
CREATE TABLE IF NOT EXISTS members_company_flow (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  "dataMail" INTEGER NOT NULL,
  "dataCalendar" INTEGER NOT NULL,
  "dataFiles" INTEGER NOT NULL,
  "startedBy" TEXT NOT NULL,
  "startedAt" INTEGER NOT NULL,
  "connectedAt" INTEGER,
  "nextSweepAt" INTEGER,
  "lastSweepAt" INTEGER,
  "lastSweepLine" TEXT
);
