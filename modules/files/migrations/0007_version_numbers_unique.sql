-- A file's version numbers never repeat (F50, 14 Nov 2026). Before the files.write fix two writes made at the same moment could both take the next number, so a file could hold two rows numbered 2.
-- Nothing is dropped or merged: for a file that has a repeated number, its rows are renumbered 1, 2, 3 ... in the order they were saved (by number, then by time, then by the order they were stored), so every saved content
-- stays in History in its true order. The file's current content does not change: the row saved last is the one the file already shows, and the file's own version number moves up to match it.
UPDATE files_file_version
   SET n = r.rn
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY n, at, rowid) AS rn
          FROM files_file_version
         WHERE file_id IN (SELECT file_id FROM files_file_version GROUP BY file_id, n HAVING COUNT(*) > 1)) AS r
 WHERE files_file_version.id = r.id;
UPDATE files_file
   SET version = m.mx
  FROM (SELECT file_id, MAX(n) AS mx FROM files_file_version GROUP BY file_id) AS m
 WHERE m.file_id = files_file.id AND m.mx > files_file.version;
CREATE UNIQUE INDEX IF NOT EXISTS "files_file_version__file_n" ON "files_file_version" ("file_id", "n");
