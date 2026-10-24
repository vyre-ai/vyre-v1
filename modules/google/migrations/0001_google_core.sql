-- google connector state. The module keeps no secret: the service account key stays in the Vault and the host mints tokens.

-- One row, id 'google': what delegation was set up with and the last probe.
CREATE TABLE IF NOT EXISTS google_config (
  id TEXT PRIMARY KEY,
  "connectionId" TEXT,
  "vaultItem" TEXT,
  "adminEmail" TEXT,
  domain TEXT,
  "clientId" TEXT,
  "clientEmail" TEXT,
  configured INTEGER NOT NULL,
  "autoConnect" INTEGER NOT NULL,
  "lastProbeAt" INTEGER,
  "lastProbeOk" INTEGER,
  updated_at INTEGER NOT NULL
);

-- Workspace users mapped to Space members by email. excluded members never get a connection.
CREATE TABLE IF NOT EXISTS google_member (
  email TEXT PRIMARY KEY,
  "userId" TEXT,
  mapped INTEGER NOT NULL,
  excluded INTEGER NOT NULL,
  "mailboxState" TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_member__user ON google_member ("userId");

-- Per member Gmail pull state: the history cursor, how active the mailbox is (it sets the polling interval) and the push watch.
CREATE TABLE IF NOT EXISTS google_mailbox (
  email TEXT PRIMARY KEY,
  "connectionId" TEXT NOT NULL,
  "historyId" TEXT,
  "lastPolledAt" INTEGER,
  "lastActivityAt" INTEGER,
  "watchExpiresAt" INTEGER,
  "pubsubTopic" TEXT,
  "nextPollAt" INTEGER
);

-- Push notices already taken, so a redelivery is accepted once.
CREATE TABLE IF NOT EXISTS google_push_seen (
  "messageId" TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- One row per Google call, keyed by the person whose Google data was reached (spec 2.18: every read is logged per person).
-- bulk = 1 for list and sync calls, which the audit keeps as sampled.
CREATE TABLE IF NOT EXISTS google_read_log (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  actor TEXT NOT NULL,
  cap TEXT NOT NULL,
  bulk INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_read_log__subject ON google_read_log (subject);
