-- Records rewritten by the server again and again (issue 906). Read-only: run it against a Space's event log, never against a live file you cannot afford to lock:
--   sqlite3 -readonly /path/to/space/events.db < scripts/ops/records-rewritten.sql
-- (or copy events.db first). It lists every record that svc_host updated more than 50 times in one UTC day, with the day, the count, the first and last time, and the record's type.
-- A healthy Space returns no rows. A writer that repeats itself every two minutes shows 720 a day per record.
SELECT
  date(at / 1000, 'unixepoch')                              AS day_utc,
  entity_id                                                 AS record_id,
  json_extract(event, '$.entity')                           AS record_type,
  count(*)                                                  AS updates_by_host,
  datetime(min(at) / 1000, 'unixepoch')                     AS first_utc,
  datetime(max(at) / 1000, 'unixepoch')                     AS last_utc
FROM events
WHERE type = 'record.updated' AND actor = 'svc_host'
GROUP BY day_utc, entity_id
HAVING count(*) > 50
ORDER BY updates_by_host DESC, day_utc DESC;
