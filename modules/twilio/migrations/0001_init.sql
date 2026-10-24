-- twilio: one account per Space, owned numbers (route and hours), webhook dedupe, A2P, idempotency, recording blobs.
CREATE TABLE IF NOT EXISTS twilio_account (
  space_id TEXT PRIMARY KEY,
  account_sid TEXT NOT NULL,
  auth_token TEXT NOT NULL,
  api_key_sid TEXT,
  api_key_secret TEXT,
  twiml_app_sid TEXT,
  voice_url TEXT
);

CREATE TABLE IF NOT EXISTS twilio_number (
  sid TEXT PRIMARY KEY,
  e164 TEXT NOT NULL,
  friendly_name TEXT,
  capabilities TEXT NOT NULL,
  voice_url TEXT,
  sms_url TEXT,
  status_url TEXT,
  twiml_app_sid TEXT,
  route_json TEXT NOT NULL,
  hours_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS twilio_number_e164 ON twilio_number (e164);

CREATE TABLE IF NOT EXISTS twilio_seen (
  dedupe_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  sid TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS twilio_a2p (
  space_id TEXT PRIMARY KEY,
  brand_sid TEXT,
  brand_status TEXT,
  campaign_sid TEXT,
  campaign_status TEXT,
  rejected_reason TEXT,
  messaging_service_sid TEXT
);

CREATE TABLE IF NOT EXISTS twilio_idem (
  idem_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS twilio_blob (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  duration_sec INTEGER,
  bytes_b64 TEXT NOT NULL
);
