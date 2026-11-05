-- The version a skill had at each saved revision (a skill from a link carries the version its package names), so History can say "v1.2.0 · Nov 4 · Installed from a link · a41f9c2".
-- A new table, not a new column: servers that already hold agents_skill_rev keep it as it is.
CREATE TABLE IF NOT EXISTS "agents_skill_rev_version" (
  "skill_id" TEXT NOT NULL,
  "rev" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  PRIMARY KEY ("skill_id", "rev")
);
