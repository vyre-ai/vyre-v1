-- previews: what was made for a file version. A preview is cached by (file, version): the state of the version, its extracted text, and the images (thumbnails and page images) as data addresses.
-- previews_file.state is ready | failed. reason (failed or text-only): unsupported | too_large | corrupt | converter_down | no_image. source is the extractor that produced the text: native | pdf | office | none.
-- previews_queue holds versions announced by file.version_added that no pass has rendered yet; the queue length is what previews.health reports.

CREATE TABLE IF NOT EXISTS previews_file (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  version_id TEXT,
  state TEXT NOT NULL,
  reason TEXT,
  pages INTEGER,
  source TEXT NOT NULL,
  text TEXT,
  text_truncated INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, version)
);

CREATE TABLE IF NOT EXISTS previews_image (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  size TEXT NOT NULL,
  page INTEGER NOT NULL,
  data TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, version, kind, size, page)
);

CREATE TABLE IF NOT EXISTS previews_queue (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, version)
);
