-- Skills for a person and what they share (owner ruling 3 Nov, lane l-skills2). The Space library and an agent's skills stay in agents_skills; these are the other scopes:
--   agents_skill_own       Mine: one person's skill, for them and the agents they pick (agents_json: ["*"] is all of them), or only in one project (project_id). Its source and version
--                          say where Update fetches from; perms_json is what it can touch; setup_json holds the Vault handles its bundled servers were given (never a value).
--   agents_skill_shares   a person shares one of their skills with chosen people, or with everyone in the Space (recipient "*").
--   agents_skill_receipts what a recipient decided: added (with the permissions they approved, and their own agent picks) or not now. No row means the card is waiting.
CREATE TABLE IF NOT EXISTS "agents_skill_own" (
  "id" TEXT PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "perms_json" TEXT NOT NULL,
  "setup_json" TEXT NOT NULL,
  "agents_json" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL,
  "at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_skill_own__name" ON "agents_skill_own" ("owner", "project_id", "name");
CREATE TABLE IF NOT EXISTS "agents_skill_shares" (
  "id" TEXT PRIMARY KEY,
  "skill_id" TEXT NOT NULL,
  "sharer" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_skill_shares__to" ON "agents_skill_shares" ("skill_id", "recipient");
CREATE TABLE IF NOT EXISTS "agents_skill_receipts" (
  "id" TEXT PRIMARY KEY,
  "skill_id" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "perms_json" TEXT NOT NULL,
  "agents_json" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_skill_receipts__who" ON "agents_skill_receipts" ("skill_id", "person");
