-- Where the six-hourly state check stopped: one row, the cursor the next run resumes from ("" = start at the beginning).
CREATE TABLE IF NOT EXISTS "state_verify_cursor" (
  "id" INTEGER PRIMARY KEY,
  "cursor" TEXT NOT NULL
);
