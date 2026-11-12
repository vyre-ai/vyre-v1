-- The earlier codes of an invite (12 Nov 2026). A create replayed with the same idempotencyKey (a slow answer and a retry) hands out a fresh code, since only hashes are kept; the code
-- already handed out is kept here, as its hash, and still opens the same invite until that invite is used, revoked or expires. Nothing is kept in the clear.
CREATE TABLE IF NOT EXISTS "members_invite_codes" (
  "code_hash" TEXT PRIMARY KEY,
  "invite" TEXT NOT NULL
);
