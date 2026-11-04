-- Browser connections (lane l-chrome2a). Every table is named browser_* (ctx.db guard, ARCH B2). One row per person and site: where it runs and each agent's right. It never holds a credential.
CREATE TABLE IF NOT EXISTS "browser_sites" (
  "id" TEXT PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "runs_in" TEXT NOT NULL,
  "rights_json" TEXT NOT NULL,
  "removed" INTEGER NOT NULL,
  "at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "browser_sites_by_owner" ON "browser_sites" ("owner", "host");
