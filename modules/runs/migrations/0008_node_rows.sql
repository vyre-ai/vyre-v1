-- What a tile needs to say about a node without replaying its events (r42-runtime): the one current step, an approval it waits on, why it looks stuck, the name of who works, and what it starts after.
ALTER TABLE runs_node ADD COLUMN step_json TEXT;
ALTER TABLE runs_node ADD COLUMN need_json TEXT;
ALTER TABLE runs_node ADD COLUMN stuck_json TEXT;
ALTER TABLE runs_node ADD COLUMN who_name TEXT;
CREATE TABLE IF NOT EXISTS "runs_dep" (
  "run_id" TEXT NOT NULL,
  "on_run" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "on_run")
);
CREATE INDEX IF NOT EXISTS "runs_dep_on" ON "runs_dep" ("on_run");
