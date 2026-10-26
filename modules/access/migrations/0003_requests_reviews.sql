-- Access requests and access reviews (P-L7_03). Every table is named access_* (ctx.db guard, ARCH B2).
-- A request asks the Manage holders of a resource for access; the grant only exists once one of them approves.
CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" TEXT PRIMARY KEY,
  "requester" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "note" TEXT,
  "state" TEXT NOT NULL,
  "idem_key" TEXT NOT NULL,
  "approvers_json" TEXT NOT NULL,
  "task_ids_json" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "decided_by" TEXT,
  "decided_at" INTEGER,
  "decision_note" TEXT,
  "grant_id" TEXT
);
CREATE INDEX IF NOT EXISTS "access_requests_by_requester" ON "access_requests" ("requester", "resource_type", "resource_id");

-- A review is a list of the grants that existed when it opened; each item has one reviewer who holds Manage on the resource.
CREATE TABLE IF NOT EXISTS "access_reviews" (
  "id" TEXT PRIMARY KEY,
  "state" TEXT NOT NULL,
  "idem_key" TEXT NOT NULL,
  "scope_json" TEXT,
  "opened_at" INTEGER NOT NULL,
  "opened_by" TEXT NOT NULL,
  "closed_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "access_review_items" (
  "review_id" TEXT NOT NULL,
  "grant_id" TEXT NOT NULL,
  "grant_json" TEXT NOT NULL,
  "reviewer" TEXT NOT NULL,
  "task_id" TEXT,
  "last_used_at" INTEGER,
  "decision" TEXT,
  "decided_at" INTEGER,
  PRIMARY KEY ("review_id", "grant_id")
);

-- A drafted change proposed by someone who can only view the object (access.propose_change, P-L7_21): the change as given, and the Review tasks it made. Nothing is written to the object.
CREATE TABLE IF NOT EXISTS "access_proposals" (
  "id" TEXT PRIMARY KEY,
  "proposer" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "change_json" TEXT NOT NULL,
  "note" TEXT,
  "idem_key" TEXT NOT NULL,
  "task_ids_json" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
