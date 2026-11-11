-- A counter that moves whenever a row of a table the access store reads is written, by anyone: the store itself, a handler that writes rows directly, a copy from another computer of a
-- Personal Space (host/src/peers), a migration, or plain SQL. access.sync keeps its store and snapshot between calls and reuses them only while this counter stands where its own last
-- write left it (modules/access/consumers.ts); any other writer moves it and the next sync reads the tables again. It is this computer's own (access_local_*, host/src/peers/sync.ts LOCAL)
-- and never travels. A migration that rebuilds one of these tables must create its three triggers again (modules/access/tests/sync.incremental.test.ts checks every table has them).
CREATE TABLE IF NOT EXISTS "access_local_stamp" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "n" INTEGER NOT NULL
);
INSERT OR IGNORE INTO "access_local_stamp" ("id", "n") VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_meta" AFTER INSERT ON "access_meta" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_meta" AFTER UPDATE ON "access_meta" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_meta" AFTER DELETE ON "access_meta" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_roles" AFTER INSERT ON "access_roles" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_roles" AFTER UPDATE ON "access_roles" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_roles" AFTER DELETE ON "access_roles" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_role_changes" AFTER INSERT ON "access_role_changes" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_role_changes" AFTER UPDATE ON "access_role_changes" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_role_changes" AFTER DELETE ON "access_role_changes" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_groups" AFTER INSERT ON "access_groups" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_groups" AFTER UPDATE ON "access_groups" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_groups" AFTER DELETE ON "access_groups" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_principals" AFTER INSERT ON "access_principals" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_principals" AFTER UPDATE ON "access_principals" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_principals" AFTER DELETE ON "access_principals" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_assignments" AFTER INSERT ON "access_assignments" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_assignments" AFTER UPDATE ON "access_assignments" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_assignments" AFTER DELETE ON "access_assignments" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_grants" AFTER INSERT ON "access_grants" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_grants" AFTER UPDATE ON "access_grants" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_grants" AFTER DELETE ON "access_grants" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_resources" AFTER INSERT ON "access_resources" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_resources" AFTER UPDATE ON "access_resources" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_resources" AFTER DELETE ON "access_resources" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_policies" AFTER INSERT ON "access_policies" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_policies" AFTER UPDATE ON "access_policies" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_policies" AFTER DELETE ON "access_policies" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_actors" AFTER INSERT ON "access_actors" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_actors" AFTER UPDATE ON "access_actors" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_actors" AFTER DELETE ON "access_actors" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_fields" AFTER INSERT ON "access_fields" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_fields" AFTER UPDATE ON "access_fields" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_fields" AFTER DELETE ON "access_fields" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_stamp_i_local_cursor" AFTER INSERT ON "access_local_cursor" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_u_local_cursor" AFTER UPDATE ON "access_local_cursor" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_stamp_d_local_cursor" AFTER DELETE ON "access_local_cursor" BEGIN UPDATE "access_local_stamp" SET "n" = "n" + 1 WHERE "id" = 1; END;
