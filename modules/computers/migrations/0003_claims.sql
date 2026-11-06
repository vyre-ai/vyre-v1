-- Room on a host (capacity.ts). One row per workload that holds or waits for room: a workspace, a browser profile, or a desktop computer that asked to wake and found the host full.
-- A running desktop is not a row here (its computer row says it is awake); a waiting one is, so the line it shows and its place in the queue survive a restart.
CREATE TABLE IF NOT EXISTS computers_claim (
  claim_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('desktop', 'workspace', 'browser')),
  host TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'waiting')),
  since INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS computers_claim_host ON computers_claim (host, state);
