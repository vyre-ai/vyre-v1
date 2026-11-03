-- The model list a subscription engine (Codex, Claude Code, Grok) gave for one account, asked of the vendor's CLI (modules/engine/live-models.ts). Saved per account so the menu answers at once
-- and keeps the list when a refresh fails. fetched_at is the last list that came back; tried_at and error the last try, which may have failed after it.
CREATE TABLE IF NOT EXISTS engine_model_cache (
  account_ref TEXT PRIMARY KEY,
  driver TEXT NOT NULL,
  models_json TEXT,
  fetched_at INTEGER,
  tried_at INTEGER,
  error TEXT
);
