// events.db tables owned by the log (ARCH 4.2). The columns after `payload` are VIRTUAL and GENERATED from the envelope JSON, so a database edit cannot disagree with the hashed event:
// changing a column means changing `event`, which the chain then catches. Hashes are stored as hex text (the envelope is JSON).

const GEN: [string, string, string][] = [
  ["id", "TEXT", "$.id"], ["type", "TEXT", "$.type"], ["sv", "INTEGER", "$.sv"], ["hlc", "TEXT", "$.hlc"], ["at", "INTEGER", "$.at"],
  ["trace_id", "TEXT", "$.trace_id"], ["span_id", "TEXT", "$.span_id"], ["actor", "TEXT", "$.actor"], ["on_behalf", "TEXT", "$.on_behalf"],
  ["device", "TEXT", "$.device"], ["run_id", "TEXT", "$.run_id"], ["cause", "TEXT", "$.cause"], ["origin", "TEXT", "$.origin"],
  ["depth", "INTEGER", "$.depth"], ["entity", "TEXT", "$.entity"], ["entity_id", "TEXT", "$.entity_id"], ["fields", "TEXT", "$.fields"],
  ["label", "INTEGER", "$.label"], ["vis", "TEXT", "$.vis"], ["enc", "INTEGER", "$.enc"], ["key_id", "TEXT", "$.key_id"],
  ["commit_", "TEXT", "$.commit"], ["prev", "TEXT", "$.prev"], ["hash", "TEXT", "$.hash"],
];

export const GENERATED_COLUMNS: readonly string[] = GEN.map(([c]) => c);

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  event TEXT NOT NULL,
  payload BLOB NOT NULL,
  ${GEN.map(([c, t, p]) => `${c} ${t} GENERATED ALWAYS AS (json_extract(event, '${p}')) VIRTUAL`).join(",\n  ")}
);
CREATE UNIQUE INDEX IF NOT EXISTS ev_id ON events(id);
CREATE INDEX IF NOT EXISTS ev_entity ON events(entity, entity_id, seq);
CREATE INDEX IF NOT EXISTS ev_type ON events(type, seq);
CREATE INDEX IF NOT EXISTS ev_trace ON events(trace_id);
CREATE INDEX IF NOT EXISTS ev_run ON events(run_id, seq);
CREATE TABLE IF NOT EXISTS event_salts (event_id TEXT PRIMARY KEY, salt BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (seq INTEGER PRIMARY KEY, hash TEXT, at INTEGER, key_id TEXT, sig BLOB);
CREATE TABLE IF NOT EXISTS consumers (name TEXT PRIMARY KEY, cursor INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, principal TEXT, cap TEXT, result BLOB, at INTEGER);
CREATE INDEX IF NOT EXISTS idem_at ON idempotency(at);
CREATE TABLE IF NOT EXISTS tombstones (kind TEXT, subject TEXT, at INTEGER, PRIMARY KEY(kind, subject));
CREATE TABLE IF NOT EXISTS log_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
