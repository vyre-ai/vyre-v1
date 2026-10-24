-- resend. Two logs, so a webhook the provider sends twice is applied once (the Svix id of an event, the Resend id of an inbound email).

CREATE TABLE IF NOT EXISTS resend_event_log (
  "eventId" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "appliedAs" TEXT,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resend_inbound_log (
  "emailId" TEXT PRIMARY KEY,
  "messageId" TEXT,
  "route" TEXT,
  "at" INTEGER NOT NULL
);
