-- sources module state (ARCH 7.4, 8). Intake: sources, deliveries, the dedupe table source_seen and unsure link matches.
-- Sync (handlers/sync.ts): one set of tables per Space, keyed by the sync type id; the engine is a library over two Stores.
CREATE TABLE IF NOT EXISTS src_sources (
  source_id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, connector TEXT, connection_id TEXT, type TEXT NOT NULL,
  verify TEXT NOT NULL, secret_name TEXT, state TEXT NOT NULL DEFAULT 'active', paused_reason TEXT, mapping TEXT, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS src_deliveries (
  delivery_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, received_at INTEGER NOT NULL, provider_id TEXT, status TEXT NOT NULL, error TEXT, record_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS src_deliveries_source ON src_deliveries (source_id, received_at);
-- The body of a delivery that has not been processed yet (failed, waiting on a person) so it can be replayed; removed once it is accepted.
CREATE TABLE IF NOT EXISTS src_payloads (delivery_id TEXT PRIMARY KEY, body TEXT NOT NULL, run_automations INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS source_seen (source TEXT NOT NULL, provider_id TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (source, provider_id));
CREATE TABLE IF NOT EXISTS src_matches (
  match_id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, source_id TEXT NOT NULL, type TEXT NOT NULL, row TEXT NOT NULL, candidates TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', record_id TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS src_matches_status ON src_matches (status, type);

CREATE TABLE IF NOT EXISTS sy_links (
  sync_type TEXT NOT NULL, local_id TEXT NOT NULL, remote_id TEXT NOT NULL, base TEXT NOT NULL, removed_at INTEGER, PRIMARY KEY (sync_type, local_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sy_links_remote ON sy_links (sync_type, remote_id);
CREATE TABLE IF NOT EXISTS sy_state (sync_type TEXT PRIMARY KEY, cursor TEXT, last_run_at INTEGER, pending_deletes TEXT);
CREATE TABLE IF NOT EXISTS sy_outbox (
  outbox_id TEXT PRIMARY KEY, sync_type TEXT NOT NULL, local_id TEXT NOT NULL, remote_id TEXT, op TEXT NOT NULL, fields TEXT NOT NULL, values_json TEXT NOT NULL, replaced TEXT,
  idem_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, trace_id TEXT, created_at INTEGER NOT NULL, done_at INTEGER, undone_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sy_outbox_idem ON sy_outbox (sync_type, idem_key);
CREATE TABLE IF NOT EXISTS sy_conflicts (
  conflict_id TEXT PRIMARY KEY, sync_type TEXT NOT NULL, local_id TEXT NOT NULL, field TEXT NOT NULL, ours TEXT, theirs TEXT, base TEXT, rule TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sy_conflicts_open ON sy_conflicts (sync_type, local_id, field) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS sy_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_type TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, run_id TEXT, trace_id TEXT);
