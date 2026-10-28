-- A derived object Activity index. Authorization remains the Space-local audit.read capability.
CREATE TABLE IF NOT EXISTS "audit_target" (
  "kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "audit_seq" INTEGER NOT NULL,
  PRIMARY KEY ("kind", "target_id", "audit_seq")
);
CREATE INDEX IF NOT EXISTS "audit_target_sequence" ON "audit_target" ("audit_seq");
