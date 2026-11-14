-- Pins with a manual order, and the small per-person layout store (lead's ruling 13 Nov 2026, P2 amendment).

-- A pin has a place among the person's pins of that kind of thing: a number the person's dragging sets, not a time. A move writes one row (the seam picks a number between two neighbours).
ALTER TABLE state_person ADD COLUMN "pin_rank" REAL;
CREATE INDEX IF NOT EXISTS state_person__pin ON state_person ("person", "type", "pin_rank") WHERE "pin_rank" IS NOT NULL;

-- How a person arranged a screen: a registered key and a small value each (lib/state-layout.ts), never content and never visible to anyone else.
CREATE TABLE IF NOT EXISTS state_layout (
  "person" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "key")
);
