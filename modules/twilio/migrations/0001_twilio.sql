-- twilio. Webhooks Twilio sends twice are applied once (the key is built from the Sid plus the status); the TwiML app of the Space; the messaging service behind each texting campaign.

CREATE TABLE IF NOT EXISTS twilio_hook_log (
  "dedupeKey" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "sid" TEXT NOT NULL,
  "twiml" TEXT,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS twilio_state (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS twilio_a2p (
  "campaignSid" TEXT PRIMARY KEY,
  "brandSid" TEXT NOT NULL,
  "serviceSid" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
