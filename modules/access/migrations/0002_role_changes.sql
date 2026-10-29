-- The previous successful permission set for the Role object diff. Values are validated catalogue keys only.
CREATE TABLE IF NOT EXISTS "access_role_changes" (
  "role_id" TEXT PRIMARY KEY,
  "before_json" TEXT NOT NULL,
  "after_json" TEXT NOT NULL,
  "by_kind" TEXT NOT NULL,
  "by_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
