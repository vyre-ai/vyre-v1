-- A person who took over an agent's Space browser (sbrowser/hold.ts). The module keeps the hold itself, so the agent's tools wait however the browser service is reached and after it restarts (it keeps its
-- own copy in memory only). `seen` is the last time the person was there (took over, opened the live view, sent input): a hold nobody has looked at for a while ends by itself.
CREATE TABLE IF NOT EXISTS computers_browser_hold (
  profile_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  since INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
-- An agent moved to Trash (agent.deleted): its Space browser profile keeps its sign-ins while it can still be restored, and is removed once it has been in Trash as long as Trash keeps things (sbrowser/forget.ts).
CREATE TABLE IF NOT EXISTS computers_browser_gone (
  profile_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
