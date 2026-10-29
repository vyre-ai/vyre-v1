-- The skill library (CHAT-DESIGN ruling 4). A row is one SKILL.md: the Space library when agent_id is empty, or the skills of one agent (what a plugin installed into that agent brings).
-- The built-in skills are files shipped in agent/skills and an agent's own skills/ folder is in Files; neither is copied here.
CREATE TABLE IF NOT EXISTS "agents_skills" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_skills__name" ON "agents_skills" ("agent_id", "name");
