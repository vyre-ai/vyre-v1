-- What my_access (the cached rows of who may see what, access_my_access) was built from, so a reader or a writer can keep its in-memory copy of those rows between calls and trust it. Two counters, both
-- this computer's own (access_local_*, host/src/peers/sync.ts LOCAL: never copied): `rows` moves whenever a row of access_my_access is written by anyone, `folders` whenever a row of the folder tables
-- (access_folders, access_placement, access_placement_prev) is. A kept copy is trusted only while both stand where they stood when it was published (modules/access/handlers/share.ts `KEPT`); what the access
-- tables themselves did since is compared with the kept copy of them. The counters live in the database, so a rolled back change rolls them back with it and the kept copy is refused.
CREATE TABLE IF NOT EXISTS "access_local_my_state" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "rows" INTEGER NOT NULL,
  "folders" INTEGER NOT NULL
);
INSERT OR IGNORE INTO "access_local_my_state" ("id", "rows", "folders") VALUES (1, 0, 0);

CREATE TRIGGER IF NOT EXISTS "access_my_i_rows" AFTER INSERT ON "access_my_access" BEGIN UPDATE "access_local_my_state" SET "rows" = "rows" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_u_rows" AFTER UPDATE ON "access_my_access" BEGIN UPDATE "access_local_my_state" SET "rows" = "rows" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_d_rows" AFTER DELETE ON "access_my_access" BEGIN UPDATE "access_local_my_state" SET "rows" = "rows" + 1 WHERE "id" = 1; END;

CREATE TRIGGER IF NOT EXISTS "access_my_i_folders" AFTER INSERT ON "access_folders" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_u_folders" AFTER UPDATE ON "access_folders" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_d_folders" AFTER DELETE ON "access_folders" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_i_placement" AFTER INSERT ON "access_placement" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_u_placement" AFTER UPDATE ON "access_placement" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_d_placement" AFTER DELETE ON "access_placement" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_i_placement_prev" AFTER INSERT ON "access_placement_prev" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_u_placement_prev" AFTER UPDATE ON "access_placement_prev" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
CREATE TRIGGER IF NOT EXISTS "access_my_d_placement_prev" AFTER DELETE ON "access_placement_prev" BEGIN UPDATE "access_local_my_state" SET "folders" = "folders" + 1 WHERE "id" = 1; END;
