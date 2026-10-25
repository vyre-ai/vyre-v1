-- Devices tables (P-L7_06). Every table is named devices_* (ctx.db guard, ARCH B2).
-- devices_device matches generated/modules/devices/schema.sql so either CREATE runs first; the field-meta table is the sync layer's.

CREATE TABLE IF NOT EXISTS "devices_device" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "name" TEXT,
  "class" TEXT,
  "epoch" REAL,
  "lastSeenAt" INTEGER,
  "location" TEXT,
  "revokedAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "devices_device__owner" ON "devices_device" ("person");

-- one row per session; 'device' sessions belong to a device, 'agent_run' sessions to the person whose agent runs
CREATE TABLE IF NOT EXISTS "devices_session" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "principal_kind" TEXT NOT NULL,
  "device_id" TEXT,
  "started_at" INTEGER NOT NULL,
  "last_seen_at" INTEGER NOT NULL,
  "location" TEXT,
  "revoked_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "devices_session_person" ON "devices_session" ("person");
CREATE INDEX IF NOT EXISTS "devices_session_device" ON "devices_session" ("device_id");

-- scope is 'space' or 'person:<id>'
CREATE TABLE IF NOT EXISTS "devices_epoch" (
  "scope" TEXT PRIMARY KEY,
  "epoch" INTEGER NOT NULL
);

-- a revoked device told us its replica, keychain entries and caches are gone
CREATE TABLE IF NOT EXISTS "devices_purge" (
  "device_id" TEXT PRIMARY KEY,
  "acked_at" INTEGER NOT NULL
);
