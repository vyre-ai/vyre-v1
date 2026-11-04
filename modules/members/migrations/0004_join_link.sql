-- The reusable "Request to join" link and the requests made through it (lane l-consolidate).
-- DECISION: the link code is kept as plain text, not a hash. A reusable link is meant to be shown again in Console, and a leaked link only lets someone ASK: every request waits for an admin, and Approve makes an ordinary one-time invite (whose code is a hash).
-- One row at most ("main"). Rotate replaces the code in place; Off keeps the row, so the role and the count survive.
CREATE TABLE IF NOT EXISTS "members_join_link" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "rotated_at" INTEGER
);

-- A person who opened the link and asked in. They are not a member (no account yet): a name and an email. Approve makes an invite for that email at the role the link had.
CREATE TABLE IF NOT EXISTS "members_join_requests" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "note" TEXT,
  "role" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "decided_by" TEXT,
  "decided_at" INTEGER,
  "invite_id" TEXT
);
