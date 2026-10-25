-- calendar core. The two entity tables repeat generated/modules/calendar/schema.sql column for column, so CREATE IF NOT EXISTS does nothing
-- once the host has applied the generated schema. calendar_sync is this module's own: the provider cursor of each calendar and when it last pulled.

CREATE TABLE IF NOT EXISTS calendar_list (
  "id" TEXT PRIMARY KEY,
  "title" TEXT,
  "color" TEXT,
  "provider" TEXT,
  "connectionId" TEXT,
  "remoteId" TEXT,
  "ownerId" TEXT,
  "personal" INTEGER,
  "state" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS calendar_list__owner ON calendar_list ("ownerId");
CREATE INDEX IF NOT EXISTS calendar_list__parent ON calendar_list ("connectionId");

CREATE TABLE IF NOT EXISTS calendar_event (
  "id" TEXT PRIMARY KEY,
  "calendarId" TEXT,
  "title" TEXT,
  "startsAt" INTEGER,
  "endsAt" INTEGER,
  "allDay" INTEGER,
  "location" TEXT,
  "joinUrl" TEXT,
  "joinProvider" TEXT,
  "description" TEXT,
  "agenda" TEXT,
  "attendees" TEXT,
  "organizer" TEXT,
  "recordIds" TEXT,
  "meetingId" TEXT,
  "providerId" TEXT,
  "status" TEXT,
  "bookedByAgentId" TEXT,
  "fromBookingPage" TEXT,
  "deletedAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS calendar_event__parent ON calendar_event ("calendarId");
CREATE INDEX IF NOT EXISTS calendar_event__start ON calendar_event ("startsAt");

-- One row per calendar that has pulled from its provider: the sync token (Google) or delta link (Microsoft), the last pass and the last good pass.
CREATE TABLE IF NOT EXISTS calendar_sync (
  "calendarId" TEXT PRIMARY KEY,
  "cursor" TEXT,
  "lastTryAt" INTEGER,
  "lastOkAt" INTEGER,
  "lastError" TEXT
);
