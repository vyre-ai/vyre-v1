-- Access core tables (P-L7_01).
-- Shared entity tables match generated/modules/access/schema.sql so either CREATE runs first.
-- Extra tables are the authorize projection: assignments, resources, policies, actors, field labels.

CREATE TABLE IF NOT EXISTS "access_roles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "builtIn" INTEGER,
  "clearance" TEXT,
  "assignableToAgents" INTEGER,
  "permissions" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_groups" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "members" TEXT,
  "managers" TEXT,
  "builtIn" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_principals" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "kind" TEXT,
  "owner" TEXT,
  "status" TEXT,
  "roles" TEXT,
  "groups" TEXT,
  "title" TEXT,
  "createdAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_grants" (
  "id" TEXT PRIMARY KEY,
  "subjectKind" TEXT,
  "subjectId" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "level" TEXT,
  "conditions" TEXT,
  "expiresAt" INTEGER,
  "by" TEXT,
  "source" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_meta" (
  "id" TEXT PRIMARY KEY,
  "epoch" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "access_assignments" (
  "holder" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  PRIMARY KEY ("holder", "role_id")
);

CREATE TABLE IF NOT EXISTS "access_resources" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL,
  "parent_id" TEXT,
  "label" TEXT NOT NULL,
  "owner_id" TEXT,
  "holds" INTEGER NOT NULL DEFAULT 0,
  "row_json" TEXT
);

CREATE TABLE IF NOT EXISTS "access_policies" (
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("key", "scope")
);

CREATE TABLE IF NOT EXISTS "access_actors" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "engineer" INTEGER NOT NULL DEFAULT 0,
  "token_hash" TEXT,
  "token_expires" INTEGER,
  "token_used" INTEGER NOT NULL DEFAULT 0,
  "cred_hash" TEXT,
  "last_seen" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_fields" (
  "k" TEXT PRIMARY KEY,
  "rank" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "access_acl" (
  "person" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "level_rank" INTEGER NOT NULL
);
