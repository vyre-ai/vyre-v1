-- Things the mail module must finish or tell a person about. "provider_route": a Mailgun route made by an add that lost a race and could not be deleted at once; a background pass keeps trying until it is gone,
-- because a second route for one address delivers every inbound message twice. "duplicate_route": two live routes for one address were found on an older database; the oldest was kept and the rest removed, and this row says so.
CREATE TABLE IF NOT EXISTS mail_cleanup (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT,
  note TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  "lastError" TEXT,
  "lastTryAt" INTEGER,
  "createdAt" INTEGER NOT NULL,
  "doneAt" INTEGER
);
