-- Per-person read and done (contract P2): an item's position in its conversation is a Space-wide arrival number, the order the Inbox filed it in. State (the `state` module) keeps, for each
-- person, how far they have read in those positions. `unread` here and `unreadCount` on the conversation stay as they were for the devices that still read them (until the replica step); they are
-- no longer what a person's unread is made of.
ALTER TABLE inbox_item ADD COLUMN "arrival" INTEGER;
CREATE INDEX IF NOT EXISTS inbox_item__arrival ON inbox_item ("arrival");

-- One row per one-time job the Inbox has done on this Space (the backfill of per-person state from the shared read flag), so a restart does not do it twice.
CREATE TABLE IF NOT EXISTS inbox_flag (
  "key" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL
);
