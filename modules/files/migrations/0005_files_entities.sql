-- The entity tables of module files (file, file version) as generated/modules/files/schema.sql declares them. The host runs only migrations/, so they are repeated here;
-- IF NOT EXISTS makes a database that already has them (tests apply the generated schema first) a no-op.
-- entity file
CREATE TABLE IF NOT EXISTS "files_file" (
  "id" TEXT PRIMARY KEY,
  "folder_id" TEXT,
  "name" TEXT,
  "kind" TEXT,
  "mime" TEXT,
  "size" REAL,
  "blob" TEXT,
  "owner" TEXT,
  "source_mount" TEXT,
  "created_at" INTEGER,
  "updated_by" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "files_file__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "files_file__owner" ON "files_file" ("owner");
CREATE INDEX IF NOT EXISTS "files_file__parent" ON "files_file" ("folder_id");

-- entity file_version
CREATE TABLE IF NOT EXISTS "files_file_version" (
  "id" TEXT PRIMARY KEY,
  "file_id" TEXT,
  "n" REAL,
  "blob" TEXT,
  "actor" TEXT,
  "reason" TEXT,
  "name" TEXT,
  "at" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "files_file_version__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "files_file_version__parent" ON "files_file_version" ("file_id");
