-- The people and agents on a number (owner, 2 Nov). A number is private to them: only they read its texts and calls, and only they text or call from it. No row for a number means assigneeId on the number still decides.
CREATE TABLE IF NOT EXISTS "telephony_number_member" (
  "numberId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "addedAt" INTEGER NOT NULL,
  PRIMARY KEY ("numberId", "memberId")
);
-- The number a person last texted or called from: the default the next time they have several.
CREATE TABLE IF NOT EXISTS "telephony_last_line" (
  "personId" TEXT PRIMARY KEY,
  "numberId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
