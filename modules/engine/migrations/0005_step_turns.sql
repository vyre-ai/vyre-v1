-- One automation AI step turn, kept by the step's attempt key (spec 2.12). A repeat of the same key (a retry, a resume after a reviewer, a recovered Run) returns this answer and
-- does not ask the model again or pay twice. No key or Vault value is stored here: the account is its handle.
CREATE TABLE IF NOT EXISTS engine_step_turns (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
