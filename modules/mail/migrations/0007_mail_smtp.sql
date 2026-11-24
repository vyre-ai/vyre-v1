-- The Space's own mail server for sending (SMTP). One row. The password is not here: "passwordHandle" names the Vault item, read at the last moment for one connection.
-- state is what the last test of this server found (unchecked, ok, failed) and detail is the sentence a person reads when it failed.

CREATE TABLE IF NOT EXISTS mail_smtp (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  security TEXT NOT NULL,
  username TEXT NOT NULL,
  "passwordHandle" TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  "checkedAt" INTEGER,
  updated_at INTEGER NOT NULL
);
