-- microsoft connector state. The module keeps no secret: the app registration stays in the Vault and the host mints application tokens.

-- One row, id 'microsoft': what consent was set up with and the last verify.
CREATE TABLE IF NOT EXISTS ms_config (
  id TEXT PRIMARY KEY,
  "connectionId" TEXT,
  "vaultItem" TEXT,
  "tenantId" TEXT,
  domain TEXT,
  "clientId" TEXT,
  configured INTEGER NOT NULL,
  "consentGiven" INTEGER NOT NULL,
  "policyConfirmed" INTEGER NOT NULL,
  "autoConnect" INTEGER NOT NULL,
  "lastVerifyAt" INTEGER,
  "nextRenewAt" INTEGER,
  updated_at INTEGER NOT NULL
);

-- Tenant users mapped to Space members by email. excluded members never get a connection.
CREATE TABLE IF NOT EXISTS ms_member (
  email TEXT PRIMARY KEY,
  "userId" TEXT,
  mapped INTEGER NOT NULL,
  excluded INTEGER NOT NULL,
  "mailboxState" TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ms_member__user ON ms_member ("userId");

-- Per member mail pull state: the delta link of each folder and how active the mailbox is (it sets the polling interval).
CREATE TABLE IF NOT EXISTS ms_mailbox (
  email TEXT PRIMARY KEY,
  "connectionId" TEXT NOT NULL,
  "deltaLinks" TEXT,
  "lastPolledAt" INTEGER,
  "lastActivityAt" INTEGER,
  "nextPollAt" INTEGER
);

-- Graph subscriptions. clientState is the value Graph echoes back on every notification, so the hook can tell ours from a stranger's.
-- maxMinutes is the longest lifetime Graph allows for the resource; the renewal Run keeps expiresAt ahead of the clock.
CREATE TABLE IF NOT EXISTS ms_subscription (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT NOT NULL,
  mailbox TEXT,
  "connectionId" TEXT NOT NULL,
  "notificationUrl" TEXT NOT NULL,
  "clientState" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "maxMinutes" INTEGER NOT NULL,
  "changeType" TEXT NOT NULL
);

-- Notifications already taken, so a redelivery is accepted once.
CREATE TABLE IF NOT EXISTS ms_notification_seen (
  "notificationId" TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

-- One row per Graph call, keyed by the person whose Microsoft data was reached (spec 2.18: every read is logged per person).
-- bulk = 1 for list and sync calls, which the audit keeps as sampled. Tenant-level calls log subject 'tenant'.
CREATE TABLE IF NOT EXISTS ms_read_log (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  actor TEXT NOT NULL,
  cap TEXT NOT NULL,
  bulk INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ms_read_log__subject ON ms_read_log (subject);
