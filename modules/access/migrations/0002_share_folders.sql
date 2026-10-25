-- Folders, placement and my_access (P-L7_02, ARCH 4.12). Entity tables match generated/modules/access/schema.sql so either CREATE runs first.
-- access_placement_prev keeps the parent an item had before it was placed, so taking it out of a folder restores it.

CREATE TABLE IF NOT EXISTS "access_folders" (
  "id" TEXT PRIMARY KEY,
  "resourceType" TEXT,
  "name" TEXT,
  "parentId" TEXT,
  "scope" TEXT,
  "owner" TEXT,
  "createdAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "access_folders__owner" ON "access_folders" ("owner");
CREATE INDEX IF NOT EXISTS "access_folders__parent" ON "access_folders" ("parentId");

CREATE TABLE IF NOT EXISTS "access_placement" (
  "id" TEXT PRIMARY KEY,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "folderId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_placement_prev" (
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "prevParent" TEXT,
  PRIMARY KEY ("resourceType", "resourceId")
);

CREATE TABLE IF NOT EXISTS "access_my_access" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "level" TEXT,
  "via" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "access_my_access__owner" ON "access_my_access" ("person");
