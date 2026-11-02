-- Tickets (lane l-tasks): a short key per Space, priority, labels, a start date, the Space's own fields, repeat, and the worker thread a crew job or helper does the task in.
-- These sit on tasks_core, the record-level half of the row, so the generated tasks_meta stays as it was.
ALTER TABLE "tasks_core" ADD COLUMN "key_no" INTEGER;
ALTER TABLE "tasks_core" ADD COLUMN "key" TEXT;
ALTER TABLE "tasks_core" ADD COLUMN "priority" TEXT;
ALTER TABLE "tasks_core" ADD COLUMN "labels" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "tasks_core" ADD COLUMN "start_at" INTEGER;
ALTER TABLE "tasks_core" ADD COLUMN "fields" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "tasks_core" ADD COLUMN "recur" TEXT;
ALTER TABLE "tasks_core" ADD COLUMN "worker_thread" TEXT;
-- the tasks made before keys existed get theirs in the order they were made
UPDATE "tasks_core" SET "key_no" = (SELECT COUNT(*) FROM "tasks_core" c2 WHERE c2."created_at" < "tasks_core"."created_at" OR (c2."created_at" = "tasks_core"."created_at" AND c2."id" <= "tasks_core"."id"));
UPDATE "tasks_core" SET "key" = 'VY-' || "key_no";
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_core_key_no" ON "tasks_core" ("key_no");
CREATE INDEX IF NOT EXISTS "tasks_core_key" ON "tasks_core" ("key");
CREATE INDEX IF NOT EXISTS "tasks_core_worker" ON "tasks_core" ("worker_thread");
CREATE INDEX IF NOT EXISTS "tasks_meta_parent" ON "tasks_meta" ("parent_task");
CREATE INDEX IF NOT EXISTS "tasks_meta_thread" ON "tasks_meta" ("thread_id");
