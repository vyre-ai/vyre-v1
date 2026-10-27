-- The last account a person explicitly put on a step, one row per principal and app.
-- A new step may start from this. A step that already stores an id does not read it.

CREATE TABLE IF NOT EXISTS "automations_account_pick" (
  "principal_id" TEXT NOT NULL,
  "app" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("principal_id", "app")
);
