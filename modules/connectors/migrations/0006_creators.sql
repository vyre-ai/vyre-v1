-- Who made each connection: the person a "needs reconnecting" note goes to when nobody else owns it (a Space connection made without a sync spec). A row only for connections made after this table; others fall to the Space's admins.
CREATE TABLE IF NOT EXISTS cn_connection_creators (connection_id TEXT PRIMARY KEY, created_by TEXT NOT NULL);
