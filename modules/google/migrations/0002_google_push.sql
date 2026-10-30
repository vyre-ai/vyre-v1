-- The one secret that proves a push came from Google. It rides on every push address we hand Google (Calendar and Drive channel token, Pub/Sub endpoint query),
-- so a request without it is refused before anything is recorded. One row, id 'google'. The token is not a credential for Google; it only authenticates Google to us.
CREATE TABLE IF NOT EXISTS google_push_secret (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
