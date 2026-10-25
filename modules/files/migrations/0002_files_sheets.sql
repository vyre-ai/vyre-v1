-- files sheets: stable row ids of table files (CSV and XLSX), one row per file and sheet.
-- version is the file version the ids belong to; an id list older than the file is never trusted (handlers/sheets.ts derives fresh ids for that version).
-- next_id is the counter for ids minted by this module (r_<n>); it never goes back.

CREATE TABLE IF NOT EXISTS files_sheet_ids (
  file_id TEXT NOT NULL,
  sheet TEXT NOT NULL,
  version INTEGER NOT NULL,
  next_id INTEGER NOT NULL DEFAULT 0,
  ids TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (file_id, sheet)
);
