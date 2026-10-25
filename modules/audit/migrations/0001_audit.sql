-- Audit tables (P-L7_06). Every table is named audit_* (ctx.db guard, ARCH B2).
-- audit_row is append-only and hash-chained: hash = sha-256(prev_hash, canonical row), the first row follows the Space's genesis hash (or the archive anchor).
-- Nothing here updates or deletes a row, except the archive move, which records an anchor first.

CREATE TABLE IF NOT EXISTS "audit_row" (
  "seq" INTEGER PRIMARY KEY,
  "id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "actor_kind" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "behalf_kind" TEXT,
  "behalf_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "class" TEXT NOT NULL,
  "before_json" TEXT,
  "after_json" TEXT,
  "trace_id" TEXT NOT NULL,
  "request_id" TEXT,
  "prev_hash" TEXT NOT NULL,
  "hash" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_row_id" ON "audit_row" ("id");
CREATE INDEX IF NOT EXISTS "audit_row_actor" ON "audit_row" ("actor_id");
CREATE INDEX IF NOT EXISTS "audit_row_at" ON "audit_row" ("at");

-- signed checkpoints of the chain (every 1000 events or 10 minutes, written by the host scheduler through audit.checkpoint)
CREATE TABLE IF NOT EXISTS "audit_checkpoint" (
  "seq" INTEGER PRIMARY KEY,
  "at" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "sig" TEXT NOT NULL
);

-- one row per archived year: the encrypted file the rows moved to
CREATE TABLE IF NOT EXISTS "audit_archive" (
  "year" INTEGER PRIMARY KEY,
  "file" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "size_bytes" INTEGER NOT NULL
);

-- 'anchor_seq' and 'anchor_hash': the last archived row, so the chain still verifies from the first row that stayed
CREATE TABLE IF NOT EXISTS "audit_meta" (
  "k" TEXT PRIMARY KEY,
  "v" TEXT NOT NULL
);
