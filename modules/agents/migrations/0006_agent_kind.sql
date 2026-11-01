-- What an agent is, as columns (hole 18, AUDIT-agents-model 4): `kind` is assistant, teammate or agent, and `projectId` is the project a teammate belongs to. The role line is words a person edits and
-- never decides privacy. Agents made before this carried the role word "assistant" and the agents_meta key teammate:<id>; both move here once and nothing reads them again.
ALTER TABLE "agents_agent" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "agents_agent" ADD COLUMN "projectId" TEXT;
UPDATE "agents_agent" SET "kind" = 'assistant' WHERE json_extract("config", '$.description') = 'assistant';
UPDATE "agents_agent" SET "kind" = 'teammate', "projectId" = (SELECT "value" FROM "agents_meta" WHERE "key" = 'teammate:' || "agents_agent"."id") WHERE "kind" = 'agent' AND EXISTS (SELECT 1 FROM "agents_meta" WHERE "key" = 'teammate:' || "agents_agent"."id");
CREATE INDEX IF NOT EXISTS "agents_agent__kind" ON "agents_agent" ("kind", "ownerId");
