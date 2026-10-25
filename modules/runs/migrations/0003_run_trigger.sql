-- What woke a Run that an event started (P-CC_34): the message, its thread and its channel, so the agent answers that message. One row per such Run.
CREATE TABLE IF NOT EXISTS "runs_trigger" (
  "run_id" TEXT PRIMARY KEY,
  "message_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "channel_id" TEXT
);
