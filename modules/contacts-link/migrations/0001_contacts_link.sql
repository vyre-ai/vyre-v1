-- contacts-link. The two entity tables repeat generated/modules/contacts-link/schema.sql column for column, so CREATE IF NOT EXISTS does
-- nothing once the host has applied the generated schema. The record types contact and company are stored by the records module, not here.

CREATE TABLE IF NOT EXISTS contacts_link_address (
  "id" TEXT PRIMARY KEY,
  "contactId" TEXT,
  "kind" TEXT,
  "value" TEXT,
  "normalized" TEXT,
  "primary" INTEGER,
  "verified" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS contacts_link_address__parent ON contacts_link_address ("contactId");
CREATE INDEX IF NOT EXISTS contacts_link_address__lookup ON contacts_link_address ("kind", "normalized");

CREATE TABLE IF NOT EXISTS contacts_link_suppression (
  "id" TEXT PRIMARY KEY,
  "channel" TEXT,
  "address" TEXT,
  "reason" TEXT,
  "source" TEXT,
  "contactId" TEXT,
  "addedAt" INTEGER,
  "addedBy" TEXT,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS contacts_link_suppression__lookup ON contacts_link_suppression ("channel", "address");
CREATE INDEX IF NOT EXISTS contacts_link_suppression__contact ON contacts_link_suppression ("contactId");

-- Duplicate suggestions a person said are not duplicates. The suggestion id is the two record ids, sorted, joined by a bar.
CREATE TABLE IF NOT EXISTS contacts_link_dismissed (
  "suggestionId" TEXT PRIMARY KEY,
  "dismissedBy" TEXT NOT NULL,
  "dismissedAt" INTEGER NOT NULL
);
