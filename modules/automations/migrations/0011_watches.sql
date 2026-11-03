-- Watching (Vyre for Chrome, lane l-chrome2b): a page or a region of a page that is checked on a rhythm, by the person's own Chrome or by an agent on its computer.
-- value is the last reading (text, capped); was/now_text keep the last change so a late alert still shows both. check_now is set by Check now and cleared by the next report.
-- thread_id is the chat the alerts go to, made on the first change.
CREATE TABLE IF NOT EXISTS "automations_watches" (
  "id" TEXT PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "region_json" TEXT,
  "every_min" INTEGER NOT NULL,
  "tell_json" TEXT NOT NULL,
  "agent_id" TEXT,
  "runs_on" TEXT NOT NULL,
  "computer_id" TEXT,
  "state" TEXT NOT NULL,
  "check_now" INTEGER NOT NULL,
  "value" TEXT,
  "last_checked_at" INTEGER,
  "next_due_at" INTEGER,
  "changes" INTEGER NOT NULL,
  "changed_at" INTEGER,
  "was" TEXT,
  "now_text" TEXT,
  "error" TEXT,
  "errors_in_row" INTEGER NOT NULL,
  "thread_id" TEXT,
  "idem_key" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "automations_watches_owner" ON "automations_watches" ("owner", "deleted_at");
CREATE INDEX IF NOT EXISTS "automations_watches_idem" ON "automations_watches" ("owner", "idem_key");
