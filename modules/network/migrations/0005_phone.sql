-- Phone access (DESIGN-computers, "Phone access through vyre.run"): the one <name>.vyre.run this computer holds at the relay, one row (id 1). The host daemon writes the outcome of
-- phone_claim and phone_release commands here; box_key is the public key a phone pins from the link (not a secret).
CREATE TABLE IF NOT EXISTS network_phone (
  id INTEGER PRIMARY KEY,
  name TEXT,
  nickname TEXT,
  state TEXT NOT NULL,
  detail TEXT,
  box_key TEXT,
  reported_at INTEGER NOT NULL
);
