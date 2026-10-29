-- The canonical editable source of a connector: its folder under Shared knowledge > connectors. A private export (connectors.export) is never recorded here and never replaces this row.
CREATE TABLE IF NOT EXISTS cn_source_folders (
  key TEXT PRIMARY KEY, folder_id TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
