-- The person an agent acted for when it made a task (lane f-asker, 13 Nov): an agent's own role on a task counts for the person it acts for only when that person is the one it was made for, in a slot, or a follower.
-- Empty for a person's own task and for a turn for nobody. Back-filled only where history proves it: the working note tasks.create already wrote from the session (baton.acting_for).
ALTER TABLE "tasks_core" ADD COLUMN "created_for" TEXT;
UPDATE "tasks_core" SET "created_for" = (SELECT json_extract(m."working_notes", '$."baton.acting_for"') FROM "tasks_meta" m WHERE m."id" = "tasks_core"."id" AND json_valid(m."working_notes")) WHERE "created_for" IS NULL;
UPDATE "tasks_core" SET "created_for" = NULL WHERE "created_for" = '' OR "created_for" NOT LIKE 'usr_%';
CREATE INDEX IF NOT EXISTS "tasks_core_created_for" ON "tasks_core" ("created_for");
