-- Delivery trail and soft-bounce retries (lane r42-email-in). One row per thing that happened to a sent message, in the order the provider says it
-- happened (out-of-order events sort by their own time). eventKey makes a replayed webhook land once. A retry sends to the one address that soft-bounced,
-- as a new message (the child) so nobody who already got the first mail gets it twice; the child maps back to the message the person sent.

CREATE TABLE IF NOT EXISTS mail_delivery_event (
  id TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  address TEXT,
  detail TEXT,
  at INTEGER NOT NULL,
  "recordedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_delivery_event__message ON mail_delivery_event ("messageId");

CREATE TABLE IF NOT EXISTS mail_delivery_retry (
  "messageId" TEXT NOT NULL,
  address TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  "nextAt" INTEGER,
  state TEXT NOT NULL,
  "lastReason" TEXT,
  "childId" TEXT,
  PRIMARY KEY ("messageId", address)
);

CREATE TABLE IF NOT EXISTS mail_delivery_child (
  "childId" TEXT PRIMARY KEY,
  "rootId" TEXT NOT NULL,
  address TEXT NOT NULL
);
