-- What an activity line keeps for an admin and not for the sentence: the error code of a failed turn, a wake id, an attempt count. The words are made at read time.
CREATE TABLE IF NOT EXISTS "goals_activity_data" (
  "goal_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "data" TEXT NOT NULL,
  PRIMARY KEY ("goal_id", "seq")
);
