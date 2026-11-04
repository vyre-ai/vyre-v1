-- A project can be archived (Archive in its right-click menu): it leaves the lists but stays readable, with everything in it. One row per archived project; Unarchive deletes it.
CREATE TABLE IF NOT EXISTS "projects_archived" (
  "projectId" TEXT PRIMARY KEY,
  "archivedAt" INTEGER NOT NULL,
  "archivedBy" TEXT NOT NULL
);
