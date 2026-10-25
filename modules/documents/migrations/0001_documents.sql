-- documents: the only state the module keeps itself. A template is a docx file flagged with documents.mark_template; the flag is metadata
-- on the file, not a new version of it. The file, its bytes and its history stay in module files.

CREATE TABLE IF NOT EXISTS documents_template (
  file_id TEXT PRIMARY KEY,
  marked_by TEXT NOT NULL,
  marked_at INTEGER NOT NULL
);
