-- files.star: one row per person and file they starred. A star is the person's own, so it is neither shared nor synced to anyone else.
CREATE TABLE IF NOT EXISTS files_star (
  person TEXT NOT NULL,
  file_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (person, file_id)
);
CREATE INDEX IF NOT EXISTS files_star__file ON files_star (file_id);
