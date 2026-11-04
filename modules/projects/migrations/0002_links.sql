-- Projects, second step: the health a manager set by hand, the status update's draft, the things linked to a project, the rules that link them by themselves, and the auto items a person unlinked.
-- Every statement is IF NOT EXISTS: the first migration's tables are untouched.

-- The manager's override of how a project stands: one value, who set it and when. No row means the health is derived from the late tasks.
CREATE TABLE IF NOT EXISTS "projects_health" (
  "projectId" TEXT PRIMARY KEY,
  "health" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

-- The status update's draft: written by Draft again or edited in place, posted by Post.
CREATE TABLE IF NOT EXISTS "projects_draft" (
  "projectId" TEXT PRIMARY KEY,
  "text" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

-- A thing linked to a project (a record, a file, a chat, a task, an artifact, a mail thread, a calendar event, a pull request, a commit, a CI run, a web address). `snapshot` holds what the link
-- was made with (a CI run's state and label, a web address's title) for kinds that have no source to ask.
CREATE TABLE IF NOT EXISTS "projects_attach" (
  "linkId" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "addedBy" TEXT NOT NULL,
  "ruleId" TEXT,
  "addedAt" INTEGER NOT NULL,
  "snapshot" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "projects_attach_ref" ON "projects_attach" ("projectId", "kind", "ref");
CREATE INDEX IF NOT EXISTS "projects_attach_kind" ON "projects_attach" ("kind", "ref");

-- A rule that links matching new items by itself: a repository, a record filter or an email domain.
CREATE TABLE IF NOT EXISTS "projects_rule" (
  "ruleId" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "spec" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "projects_rule_project" ON "projects_rule" ("projectId");

-- An auto item that a person unlinked: it never comes back by rule.
CREATE TABLE IF NOT EXISTS "projects_exception" (
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "kind", "ref")
);
