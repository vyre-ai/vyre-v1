-- github, a person's own connection (lane l-ci-runners). One row per person who connected GitHub: who they are on GitHub and when the connection ends. The refresh token is in the person's own Vault (Mine), never here.
-- github_policy is what each person lets each kind of use do: always, ask first, or never. github_grant is an approved "ask first", good for a few minutes. github_use is the last use per consumer, for the "Used by" list.
CREATE TABLE IF NOT EXISTS github_me (
  "person" TEXT PRIMARY KEY,
  "login" TEXT NOT NULL,
  "githubId" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "connectedAt" INTEGER NOT NULL,
  "needsReconnect" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS github_me_state (
  "state" TEXT PRIMARY KEY,
  "person" TEXT NOT NULL,
  "verifier" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "usedAt" INTEGER
);

CREATE TABLE IF NOT EXISTS github_policy (
  "person" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  PRIMARY KEY ("person", "action")
);

CREATE TABLE IF NOT EXISTS github_grant (
  "person" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "until" INTEGER NOT NULL,
  PRIMARY KEY ("person", "repo", "action")
);

CREATE TABLE IF NOT EXISTS github_use (
  "person" TEXT NOT NULL,
  "consumer" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "consumer")
)
