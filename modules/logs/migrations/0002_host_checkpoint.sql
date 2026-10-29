-- Canonical ingestion commits these source watermarks with the scrubbed batch.
-- A failed write replays from the native logs.db without duplicating canonical rows.
CREATE TABLE IF NOT EXISTS logs_host_checkpoint (
 source TEXT PRIMARY KEY,
 row_id INTEGER NOT NULL,
 span_id INTEGER NOT NULL
);
