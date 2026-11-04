-- Projects, the Overview as a page (owner, 4 Nov 2026): the page's blocks (text, headings and live blocks that store only a spec), every revision of it with its author so a change can be undone,
-- and the Space's page templates.

CREATE TABLE IF NOT EXISTS "projects_doc" (
  "projectId" TEXT PRIMARY KEY,
  "rev" INTEGER NOT NULL,
  "blocks" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

-- One row per change. `blocks` is the page after the change; `before` the blocks it replaced and `props` the property values it replaced, so Undo restores both.
CREATE TABLE IF NOT EXISTS "projects_doc_rev" (
  "projectId" TEXT NOT NULL,
  "rev" INTEGER NOT NULL,
  "blocks" TEXT NOT NULL,
  "before" TEXT NOT NULL,
  "props" TEXT,
  "byWho" TEXT NOT NULL,
  "authorKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "undoOf" INTEGER,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "rev")
);

CREATE TABLE IF NOT EXISTS "projects_page_template" (
  "templateId" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "blocks" TEXT NOT NULL,
  "builtin" INTEGER NOT NULL,
  "byWho" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
