-- An email belongs to every contact on it (owner, 3 Nov): the sender's or first recipient's conversation holds the item, and each other participant who is a known
-- contact gets a row here, so the thread shows, whole and with one read state, under every one of them. One row per item and contact.
CREATE TABLE IF NOT EXISTS inbox_party (
  "itemId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  PRIMARY KEY ("itemId", "contactId")
);
CREATE INDEX IF NOT EXISTS inbox_party__contact ON inbox_party ("contactId");
