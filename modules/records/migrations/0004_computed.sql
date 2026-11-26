-- records: computed values (formula, lookup, rollup). The values are DERIVED: they are never part of a record's own data, are not synced, and can always be rebuilt from the records. Created lazily by
-- handlers/computed.ts, which runs this same DDL in the Space store (next to the rt_ tables, so a read joins them).
CREATE TABLE IF NOT EXISTS records_computed (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,                 -- canonical JSON of the value, NULL when it is empty
  computed_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'formula', -- formula | lookup | rollup
  inputs TEXT NOT NULL,       -- JSON: the fields it was computed from (type.field), so a read can hide it from a person who may not see one
  link_ids TEXT,              -- lookup and rollup: JSON, the ids of the records it was computed from; a read judges THESE links, not the record's links as they are later
  links INTEGER,              -- lookup and rollup: how many records it read through the relation (a read compares it with the links the person may see)
  PRIMARY KEY (type, id, field)
);
CREATE INDEX IF NOT EXISTS records_computed_field ON records_computed (type, field, id);

-- one row per computed field that has been (or is being) filled for every record of its type; def_hash says which definition the values are from, so a changed definition starts again
CREATE TABLE IF NOT EXISTS records_computed_job (
  type TEXT NOT NULL,
  field TEXT NOT NULL,
  def_hash TEXT NOT NULL,
  cursor TEXT,                -- the last record id done
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,        -- running | done
  PRIMARY KEY (type, field)
);
