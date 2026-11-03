-- Notes (lane L2): one row per note. Who reads it is in the row: the owner, share_people_json ({"usr_x":{"role":"edit"|"view","removed_at":null|ms}}) and share_space.
-- search_text is the lower-cased title, text, labels, link and clipped page, kept on every write, so notes.search and notes.list filter in SQL.
-- image_blob is a blob with no access-layer resource: the blob route never serves it; notes.image does, after the module's own check.
CREATE TABLE IF NOT EXISTS notes_notes (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  color TEXT NOT NULL,
  pinned INTEGER NOT NULL,
  labels_json TEXT NOT NULL,
  image_blob TEXT,
  image_type TEXT,
  link_json TEXT,
  clip_json TEXT,
  shot_blob TEXT,
  linked_json TEXT NOT NULL,
  share_people_json TEXT NOT NULL,
  share_space TEXT NOT NULL,
  search_text TEXT NOT NULL,
  idem_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS notes_notes_owner ON notes_notes (owner, deleted_at);
CREATE INDEX IF NOT EXISTS notes_notes_idem ON notes_notes (owner, idem_key);
