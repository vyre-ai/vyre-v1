-- The hosts a connection's key may be sent to, written when the connection is made (b-connect2, 15 Nov 2026): the hosts its connector's actions call, as a JSON list. A request to any other host is refused
-- before the key is filled, even if the connector's definition was widened afterwards. A connection made before this table has no row here and keeps the connector's declared domains as its limit.
CREATE TABLE IF NOT EXISTS cn_connection_hosts (connection_id TEXT PRIMARY KEY, hosts TEXT NOT NULL);

-- The one-time record of connections that predate this table: their rows are written once, from the connector version that was live when each was made, and never again from a later definition (an agent that republishes a
-- connector must not be able to approve its own hosts by waiting for a restart). One row, once the pass has run.
CREATE TABLE IF NOT EXISTS cn_host_backfill (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL);
