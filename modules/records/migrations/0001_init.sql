-- records: clocks and history beside the rt_<type> projection tables (ARCH 4.3).
-- rt_<type> and rt_<type>__fm are created by the records.rows and records.field_meta
-- projections when a type is defined. These two tables are the module's own rows.
CREATE TABLE IF NOT EXISTS records_field_history (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,
  hlc TEXT NOT NULL,
  actor TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_field_history_row ON records_field_history (type, id, field);

CREATE TABLE IF NOT EXISTS records_row_meta (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT,
  label INTEGER NOT NULL DEFAULT 0,
  holds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type, id)
);
