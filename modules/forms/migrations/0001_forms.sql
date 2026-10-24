-- forms: form definitions, per-field modes, signed links, submissions, attribution, Source rules, rate-limit hits, booking pages and bookings.
-- Secrets are never stored in the clear: signing_key is a per-form random key used only to sign links; link tokens are stored as SHA-256 hashes.
-- Status values: form.kind is public | one_use | booking | survey; form.state is draft | published | closed; booking.state is booked | cancelled | rescheduled.

CREATE TABLE IF NOT EXISTS forms_form (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  record_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  slug TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'space',
  folder_id TEXT,
  match_rule TEXT NOT NULL,
  consent_text TEXT,
  captcha INTEGER NOT NULL DEFAULT 0,
  upload_policy TEXT,
  rate_limit INTEGER NOT NULL DEFAULT 30,
  theme TEXT,
  css TEXT,
  logic TEXT,
  thank_you TEXT,
  signing_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS forms_form__slug ON forms_form (slug);

CREATE TABLE IF NOT EXISTS forms_field (
  form_id TEXT NOT NULL,
  field TEXT NOT NULL,
  mode TEXT NOT NULL,
  prefill_key TEXT,
  step INTEGER,
  position INTEGER NOT NULL,
  PRIMARY KEY (form_id, field)
);

CREATE TABLE IF NOT EXISTS forms_link (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  single_use INTEGER NOT NULL,
  missing TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  partial TEXT,
  partial_step INTEGER,
  partial_expires_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS forms_link__hash ON forms_link (token_hash);

CREATE TABLE IF NOT EXISTS forms_submission (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  principal TEXT NOT NULL,
  link_id TEXT,
  consent INTEGER NOT NULL,
  digest TEXT NOT NULL,
  answers TEXT
);

CREATE TABLE IF NOT EXISTS forms_attribution (
  record_id TEXT PRIMARY KEY,
  first TEXT,
  first_channel TEXT,
  first_at INTEGER,
  latest TEXT,
  latest_channel TEXT,
  latest_at INTEGER
);

CREATE TABLE IF NOT EXISTS forms_source_rule (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  match_json TEXT NOT NULL,
  channel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forms_hit (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forms_booking_page (
  form_id TEXT PRIMARY KEY,
  host_ids TEXT NOT NULL,
  length_minutes INTEGER NOT NULL,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  hours TEXT NOT NULL,
  notice_minutes INTEGER NOT NULL DEFAULT 60,
  alerted_at INTEGER
);

CREATE TABLE IF NOT EXISTS forms_booking (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  tz TEXT NOT NULL,
  event_id TEXT,
  created_at INTEGER NOT NULL
);
