-- telephony: numbers, calls, texts and the texting registration. The four entity tables match generated/modules/telephony/schema.sql column for column (either CREATE may run first); the rest is
-- this module's own: telephony_call_meta keeps what a call needs beyond its row (recording, hold, consent, who was rung), telephony_send_log counts texts per number for the caps, telephony_state holds small
-- facts such as the Files folder of recordings.

CREATE TABLE IF NOT EXISTS "telephony_call" (
  "id" TEXT PRIMARY KEY,
  "numberId" TEXT,
  "direction" TEXT,
  "from" TEXT,
  "to" TEXT,
  "contactId" TEXT,
  "state" TEXT,
  "startedAt" INTEGER,
  "answeredAt" INTEGER,
  "endedAt" INTEGER,
  "durationSec" INTEGER,
  "handledBy" TEXT,
  "recordingFileId" TEXT,
  "transcript" TEXT,
  "summary" TEXT,
  "consentLogged" INTEGER,
  "twilioSid" TEXT,
  "traceId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "telephony_call__parent" ON "telephony_call" ("numberId");

CREATE TABLE IF NOT EXISTS "telephony_number" (
  "id" TEXT PRIMARY KEY,
  "e164" TEXT,
  "title" TEXT,
  "capabilities" TEXT,
  "assigneeKind" TEXT,
  "assigneeId" TEXT,
  "route" TEXT,
  "hours" TEXT,
  "recording" TEXT,
  "a2p" TEXT,
  "state" TEXT,
  "twilioSid" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "telephony_number__owner" ON "telephony_number" ("assigneeId");

CREATE TABLE IF NOT EXISTS "telephony_sms" (
  "id" TEXT PRIMARY KEY,
  "numberId" TEXT,
  "direction" TEXT,
  "from" TEXT,
  "to" TEXT,
  "body" TEXT,
  "status" TEXT,
  "contactId" TEXT,
  "mediaFileIds" TEXT,
  "campaignId" TEXT,
  "at" INTEGER,
  "twilioSid" TEXT,
  "traceId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "telephony_sms__parent" ON "telephony_sms" ("numberId");

CREATE TABLE IF NOT EXISTS "telephony_registration" (
  "id" TEXT PRIMARY KEY,
  "legalName" TEXT,
  "ein" TEXT,
  "website" TEXT,
  "address" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "useCase" TEXT,
  "sampleMessages" TEXT,
  "optInDescription" TEXT,
  "state" TEXT,
  "rejectedReason" TEXT,
  "submittedAt" INTEGER,
  "twilioBrandSid" TEXT,
  "twilioCampaignSid" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS telephony_call_meta (
  "callId" TEXT PRIMARY KEY,
  "hold" INTEGER NOT NULL DEFAULT 0,
  "recording" INTEGER NOT NULL DEFAULT 0,
  "recordingSid" TEXT,
  "consent" TEXT,
  "ringing" TEXT,
  "declined" TEXT,
  "ingestedSid" TEXT
);

CREATE TABLE IF NOT EXISTS telephony_send_log (
  "id" TEXT PRIMARY KEY,
  "numberId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telephony_state (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
