-- github. This module's own tables. The App is one row (one GitHub App per Space); its secrets are Vault items and never live here.
-- github_app_state holds the one-time state of a manifest flow, github_installation what GitHub told us about the App's installations,
-- github_delivery the deliveries already applied (GitHub redelivers on request and on failure), github_fix how many "ask the author agent to fix" rounds
-- each pull request has had (the loop stops at three).

CREATE TABLE IF NOT EXISTS github_app (
  "id" TEXT PRIMARY KEY,
  "appId" INTEGER NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "permissions" TEXT NOT NULL,
  "events" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_app_state (
  "state" TEXT PRIMARY KEY,
  "org" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "usedAt" INTEGER
);

CREATE TABLE IF NOT EXISTS github_installation (
  "id" INTEGER PRIMARY KEY,
  "account" TEXT NOT NULL,
  "repositorySelection" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_delivery (
  "deliveryId" TEXT PRIMARY KEY,
  "event" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_fix (
  "fixKey" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
