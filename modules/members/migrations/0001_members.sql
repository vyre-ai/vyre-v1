-- Members tables (P-L7_05). Every table is named members_* (ctx.db guard, ARCH B2).
-- An invite code is stored only as a hash. Lists (groups, agents, projects, channels) are JSON arrays of ids.

CREATE TABLE IF NOT EXISTS "members_invites" (
  "id" TEXT PRIMARY KEY,
  "code_hash" TEXT NOT NULL UNIQUE,
  "role" TEXT NOT NULL,
  "groups" TEXT NOT NULL,
  "agents" TEXT NOT NULL,
  "projects" TEXT NOT NULL,
  "channels" TEXT NOT NULL,
  "email" TEXT,
  "expires_at" INTEGER NOT NULL,
  "created_by" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "ai_key_handle" TEXT,
  "accepted_by" TEXT,
  "accepted_at" INTEGER,
  "idem_key" TEXT,
  "created_at" INTEGER NOT NULL
);

-- What happens to a person after they join, one row per person, steps tracked one by one so a failed step is retried and never repeated.
CREATE TABLE IF NOT EXISTS "members_joins" (
  "person_id" TEXT PRIMARY KEY,
  "invite_id" TEXT NOT NULL,
  "steps" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "joined_at" INTEGER NOT NULL,
  "applied_at" INTEGER
);

-- Lifecycle after the join: suspended and removed people (an active person has no row).
CREATE TABLE IF NOT EXISTS "members_status" (
  "person_id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "plan" TEXT,
  "export_until" INTEGER,
  "key_rotation_pending" INTEGER NOT NULL DEFAULT 0
);

-- Sign-in policy and SSO providers: key 'sign_in' holds the policy, 'sso:<key>' one provider each.
CREATE TABLE IF NOT EXISTS "members_policy" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_by" TEXT NOT NULL
);
