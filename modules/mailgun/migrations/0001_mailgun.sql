-- mailgun. Two logs, so a webhook the provider sends twice is applied once (the event id, the Message-Id of an inbound email).

CREATE TABLE IF NOT EXISTS mailgun_event_log (
  "eventId" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "appliedAs" TEXT,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailgun_inbound_log (
  "messageId" TEXT PRIMARY KEY,
  "mailMessageId" TEXT,
  "recipient" TEXT,
  "at" INTEGER NOT NULL
);
