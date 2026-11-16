-- The hosts a connection's key may be sent to, written when the connection is made (b-connect2, 15 Nov 2026): the hosts its connector's actions call, as a JSON list. A request to any other host is refused
-- before the key is filled, even if the connector's definition was widened afterwards. A connection made before this table has no row here and keeps the connector's declared domains as its limit.
CREATE TABLE IF NOT EXISTS cn_connection_hosts (connection_id TEXT PRIMARY KEY, hosts TEXT NOT NULL);
