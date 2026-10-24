-- network module tables (P-L7b_07; spec Networking, ARCH 5.9, 7.10). Every table is prefixed network_ because ctx.db refuses any other name.
-- The host daemon (caddy driver, relay client, connection manager) reports into these tables; Console actions are written to network_command.

-- One row, id 1: the Space address, how it is reached, and what the host knows about ingress.
CREATE TABLE IF NOT EXISTS network_config (
  id INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  mode TEXT NOT NULL,
  domain TEXT,
  relay_address TEXT,
  public_ingress INTEGER NOT NULL,
  ingress_detail TEXT,
  reported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS network_cert (
  host TEXT PRIMARY KEY,
  expires_at INTEGER,
  reason TEXT,
  reported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS network_host (
  host TEXT PRIMARY KEY,
  kind TEXT NOT NULL
);

-- DNS check results the host made for a domain: ok, and the records the owner has to add.
CREATE TABLE IF NOT EXISTS network_dns (
  domain TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  records_json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

-- Servers in the Space. state is what the server reported; heartbeat_at decides whether it is still believed.
CREATE TABLE IF NOT EXISTS network_server (
  server_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  heartbeat_at INTEGER
);

-- Endpoints the connection manager can use, each with the last heartbeat and round trip time.
CREATE TABLE IF NOT EXISTS network_endpoint (
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  rtt_ms INTEGER,
  heartbeat_at INTEGER,
  PRIMARY KEY (kind, url)
);

CREATE TABLE IF NOT EXISTS network_join (
  code TEXT PRIMARY KEY,
  by_principal TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Asks for the host daemon: set_domain, set_mode, renew, reconnect, remove. done_at empty means open.
CREATE TABLE IF NOT EXISTS network_command (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  by_principal TEXT NOT NULL,
  at INTEGER NOT NULL,
  done_at INTEGER
);
