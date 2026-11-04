-- Install from a link, and skills that agents own and share (owner, 4 Nov 2026).
--   agents_skill_grants  an agent holds a skill: use (it is in the agent's list), edit (it may save a new version) or manage (it may share it on). The owner of a skill is in agents_skill_own.owner,
--                        a person or an agent.
--   agents_skill_rev     every version of a skill, with who saved it, so a change can be undone. The skill row holds the latest.
--   agents_install       what a link was read as (the plan, pinned to a commit) and, once it is approved, what was put where.
CREATE TABLE IF NOT EXISTS "agents_skill_grants" (
  "skill_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "by_who" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("skill_id", "agent_id")
);
CREATE INDEX IF NOT EXISTS "agents_skill_grants__agent" ON "agents_skill_grants" ("agent_id");
CREATE TABLE IF NOT EXISTS "agents_skill_rev" (
  "skill_id" TEXT NOT NULL,
  "rev" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "by_who" TEXT NOT NULL,
  "author_kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "undo_of" INTEGER,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("skill_id", "rev")
);
CREATE TABLE IF NOT EXISTS "agents_install" (
  "id" TEXT PRIMARY KEY,
  "asker" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "commit_sha" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "plan_json" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "installed_json" TEXT NOT NULL,
  "update_of" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "done_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_install__asker" ON "agents_install" ("asker", "state");
