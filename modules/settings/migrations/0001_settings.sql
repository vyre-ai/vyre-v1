-- Settings tables (P-L7_08). Every table is named settings_* (ctx.db guard, ARCH B2).
-- A row is one value set on purpose: scope 'space' (person is '') for a Space-wide value, scope 'person' for one person's own value in this Space.
-- The shipped default lives in the manifest registry, not here, so a setting nobody changed has no row and costs nothing.

CREATE TABLE IF NOT EXISTS "settings_value" (
  "setting" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "changed_by" TEXT,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("setting", "scope", "person")
);

-- the owner floor: the least strict value anyone may choose for a floorable setting
CREATE TABLE IF NOT EXISTS "settings_floor" (
  "setting" TEXT PRIMARY KEY,
  "floor" TEXT NOT NULL,
  "changed_by" TEXT,
  "updated_at" INTEGER NOT NULL
);
