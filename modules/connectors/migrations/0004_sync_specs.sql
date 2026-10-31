-- SyncSpecs: the document an agent filled to bring an app's records into Records, kept per connector so Edit mapping can open the agent with it. The spec holds a Vault handle, never a value.
CREATE TABLE IF NOT EXISTS cn_sync_specs (
  connector TEXT PRIMARY KEY, spec TEXT NOT NULL, connection_id TEXT NOT NULL, applied_by TEXT, applied_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cn_sync_spec_types (
  type TEXT NOT NULL, connector TEXT NOT NULL, remote TEXT NOT NULL, PRIMARY KEY (type, connector)
);
