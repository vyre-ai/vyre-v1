-- Why the automatic move onto a pipeline stopped for a Journey (a type that already has a Journey, records that could not be moved). The background job skips a Journey that has a note until a person presses Retry (journeys.to_pipeline).
ALTER TABLE "journeys_defs" ADD COLUMN "migrate_note" TEXT;
