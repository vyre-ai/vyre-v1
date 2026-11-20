-- Values a Journey carries from stage to stage for one record (rc.41): a key the Journey declares and a JSON value. Automation steps read them as {{journey.plan}} and write them with the "Remember for the Journey" step.
CREATE TABLE IF NOT EXISTS "journeys_values" (
  "record_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "by_who" TEXT NOT NULL,
  PRIMARY KEY ("record_id", "key")
);
