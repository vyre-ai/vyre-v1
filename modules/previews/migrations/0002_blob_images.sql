-- previews: images are blobs (ctx.blobs), not data addresses (P-L4_07b). previews_image keeps the blob id, content type and size instead of the bytes; the old `data` column goes.
-- Previews made before this are dropped with their file rows, so the next read makes them again as blobs. previews_gc holds blob ids whose rows the file.purged projection removed
-- (a projection has no blob port); the next render pass deletes those blobs.

DROP TABLE IF EXISTS previews_image;
DELETE FROM previews_file;
DELETE FROM previews_queue;

CREATE TABLE IF NOT EXISTS previews_image (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  size TEXT NOT NULL,
  page INTEGER NOT NULL,
  blob_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, version, kind, size, page)
);

CREATE TABLE IF NOT EXISTS previews_gc (
  blob_id TEXT PRIMARY KEY,
  queued_at INTEGER NOT NULL
);
