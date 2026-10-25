-- campaigns: definitions, steps, A/B variants, per-contact membership, sends, replies, unsubscribe tokens, warmup state and settings.
-- Rates are stored as basis points (10000 = 100 percent) so every column is TEXT or INTEGER.
-- Status values: campaign.state is draft | scheduled | running | paused | stopped | completed; member.state is screening | active | replied | unsubscribed | suppressed | completed | stopped | failed.

CREATE TABLE IF NOT EXISTS campaigns_campaign (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  owner TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'space',
  folder_id TEXT,
  audience_type TEXT,
  audience_view_id TEXT,
  audience_filter TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL,
  windows TEXT,
  throttle_per_hour INTEGER,
  stop_on_reply INTEGER NOT NULL DEFAULT 1,
  run_id TEXT,
  pause_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  launched_at INTEGER,
  completed_at INTEGER,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaigns_step (
  campaign_id TEXT NOT NULL,
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  next TEXT,
  PRIMARY KEY (campaign_id, key)
);

CREATE TABLE IF NOT EXISTS campaigns_variant (
  campaign_id TEXT NOT NULL,
  key TEXT NOT NULL,
  weight INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  config TEXT NOT NULL,
  PRIMARY KEY (campaign_id, key)
);

CREATE TABLE IF NOT EXISTS campaigns_member (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  tz TEXT,
  variant TEXT,
  state TEXT NOT NULL,
  step_key TEXT,
  due_at INTEGER,
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  replied_at INTEGER,
  reply_announced INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_member__record ON campaigns_member (campaign_id, record_id);
CREATE INDEX IF NOT EXISTS campaigns_member__campaign ON campaigns_member (campaign_id);

CREATE TABLE IF NOT EXISTS campaigns_send (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  mailbox_id TEXT,
  domain TEXT,
  message_ref TEXT,
  status TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaigns_send__campaign ON campaigns_send (campaign_id);
CREATE INDEX IF NOT EXISTS campaigns_send__ref ON campaigns_send (message_ref);

CREATE TABLE IF NOT EXISTS campaigns_reply (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  message_ref TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns_unsub (
  token_hash TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  address TEXT NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaigns_warmup (
  mailbox_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  bounce_bp INTEGER NOT NULL DEFAULT 0,
  reply_bp INTEGER NOT NULL DEFAULT 0,
  spam_bp INTEGER NOT NULL DEFAULT 0,
  slowed_reason TEXT,
  slowed_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaigns_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
