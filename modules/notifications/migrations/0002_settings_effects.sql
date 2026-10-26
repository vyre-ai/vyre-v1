-- notifications_setting: my notification settings as the settings module last announced them (settings.changed), read by the deliver path. No row means the shipped default.
CREATE TABLE IF NOT EXISTS "notifications_setting" (
  "person" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  PRIMARY KEY ("person", "key")
);
-- one summary is scheduled per quiet window and person
CREATE TABLE IF NOT EXISTS "notifications_quiet_summary" (
  "person" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "at")
);
-- P-CC_22 first added this table to 0001, which a Space may already have applied: create it here too (idempotent).
CREATE TABLE IF NOT EXISTS "notifications_kind_levels" (
  "person" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "channels" TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY ("person", "kind")
);
