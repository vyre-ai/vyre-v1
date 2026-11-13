-- Why a goal's check-ins are held back. A check-in turn that failed for a reason the person has to fix (the Vault is locked, a sign-in is missing), for an AI account at its limit, or for a trouble that kept coming back,
-- is not asked again every minute: the wake-up waits (goals_wake.state = 'waiting') and this row says why, since when, until when, how many check-ins went by, and which Needs-you item told the owner.
CREATE TABLE IF NOT EXISTS "goals_block" (
  "goal_id" TEXT PRIMARY KEY,
  "wake_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "cause" TEXT NOT NULL,
  "since" INTEGER NOT NULL,
  "from_status" TEXT,
  "until" INTEGER,
  "resumes" INTEGER NOT NULL DEFAULT 0,
  "missed" INTEGER NOT NULL DEFAULT 0,
  "task_id" TEXT,
  "told_at" INTEGER
);
