-- identity: when a person last changed their own password (Settings > Sign-in and devices says "Changed ..."); until they have, the day they joined stands.
CREATE TABLE IF NOT EXISTS "identity_password_changed" (
  "person_id" TEXT PRIMARY KEY,
  changed_at INTEGER NOT NULL
);
