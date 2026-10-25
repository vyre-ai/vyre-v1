-- Console assistant tables (P-L7b_10). Every table is named console_assistant_* (ctx.db guard, ARCH B2).
-- One assistant thread per person and Space: the thread itself lives in chat, this row remembers whose it is and the page it follows.
CREATE TABLE IF NOT EXISTS "console_assistant_thread" (
  "person_id" TEXT PRIMARY KEY,
  "thread_id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "page" TEXT NOT NULL,
  "object_ref" TEXT,
  "opened_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "console_assistant_thread_by_thread" ON "console_assistant_thread" ("thread_id");

-- A proposed change (diff card). state: proposed, filed (sent to the Manage holders as a Review task), applied, rejected.
-- changes_json holds the edits as proposed: {path, before, after}. Nothing here is applied until a person presses Apply.
CREATE TABLE IF NOT EXISTS "console_assistant_diff" (
  "diff_id" TEXT PRIMARY KEY,
  "thread_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "affects" TEXT,
  "changes_json" TEXT NOT NULL,
  "proposed_by_kind" TEXT NOT NULL,
  "proposed_by_id" TEXT NOT NULL,
  "proposed_at" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "decided_by" TEXT,
  "decided_at" INTEGER,
  "audit_id" TEXT,
  "task_id" TEXT,
  "note" TEXT
);
CREATE INDEX IF NOT EXISTS "console_assistant_diff_by_thread" ON "console_assistant_diff" ("thread_id");
