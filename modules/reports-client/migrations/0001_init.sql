-- reports-client module tables (P-L7b_08; spec 4.18, b9, ARCH 7.14).
-- Every table is prefixed reports_ because ctx.db refuses any other name.

-- One row per problem report. status is new, sent or resolved. bundle_json is the bundle after redaction, exactly what is previewed and sent.
-- redactions counts the values removed. task_id is the Review task the admins see in Needs you.
CREATE TABLE IF NOT EXISTS reports_client_report (
  report_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  reporter TEXT NOT NULL,
  at INTEGER NOT NULL,
  trace_ids TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  redactions INTEGER NOT NULL,
  task_id TEXT,
  issue_number INTEGER,
  sent_at INTEGER,
  fixed_in TEXT
);
CREATE INDEX IF NOT EXISTS reports_report_reporter ON reports_client_report(reporter, at);
CREATE INDEX IF NOT EXISTS reports_report_at ON reports_client_report(at);
