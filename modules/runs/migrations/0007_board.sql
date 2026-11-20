-- The board of a tree and the messages between its nodes (r42-runtime, DESIGN-r42-runtime.md section 4). The board is what the nodes of one tree know together: facts and decisions with the evidence they stand on, and open questions.
-- A message goes from one node to another (a sibling, the parent) and is delivered at the receiver's next step; delivered_at and seen_at say how far it got.
CREATE TABLE IF NOT EXISTS "runs_board" (
  "id" TEXT PRIMARY KEY,
  "root_run" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "topic" TEXT,
  "text" TEXT NOT NULL,
  "by_run" TEXT NOT NULL,
  "evidence_json" TEXT NOT NULL DEFAULT '[]',
  "at" INTEGER NOT NULL,
  "superseded_by" TEXT,
  "answer_by" TEXT,
  "answer_text" TEXT,
  "answer_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "runs_board_root" ON "runs_board" ("root_run", "at");
CREATE INDEX IF NOT EXISTS "runs_board_topic" ON "runs_board" ("root_run", "topic");

CREATE TABLE IF NOT EXISTS "runs_message" (
  "id" TEXT PRIMARY KEY,
  "root_run" TEXT NOT NULL,
  "from_run" TEXT NOT NULL,
  "to_run" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "delivered_at" INTEGER,
  "seen_at" INTEGER,
  "msg_key" TEXT
);
CREATE INDEX IF NOT EXISTS "runs_message_to" ON "runs_message" ("to_run", "delivered_at");
CREATE INDEX IF NOT EXISTS "runs_message_root" ON "runs_message" ("root_run", "at");
CREATE UNIQUE INDEX IF NOT EXISTS "runs_message_key" ON "runs_message" ("from_run", "msg_key") WHERE "msg_key" IS NOT NULL;
