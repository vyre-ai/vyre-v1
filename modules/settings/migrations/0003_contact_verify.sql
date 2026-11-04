-- Email and phone verification of the profile contact (lane l-chrome2a). A code waits here as a hash (never the code), for one person and one channel, until it is confirmed, expires or is replaced.
-- A verified row says which value was confirmed; the tick shows only while the contact still holds that value, so changing it clears the tick.

CREATE TABLE IF NOT EXISTS "settings_contact_code" (
  "person" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "attempts" INTEGER NOT NULL,
  "sent_at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "channel")
);

-- every code sent, for the hourly limit
CREATE TABLE IF NOT EXISTS "settings_contact_sent" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "person" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "settings_contact_verified" (
  "person" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "verified_at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "channel")
);
