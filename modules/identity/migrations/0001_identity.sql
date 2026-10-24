-- Identity tables (P-L7_04). Every table is named identity_* (ctx.db guard, ARCH B2).
-- The server holds a salted scrypt verifier of the login secret, TOTP secrets, and wrapped key bundles (ciphertext only).

CREATE TABLE IF NOT EXISTS "identity_space" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "logo_file_id" TEXT,
  "fingerprint" TEXT NOT NULL,
  "github" INTEGER NOT NULL DEFAULT 0,
  "second_factor_required" INTEGER NOT NULL DEFAULT 0,
  "sso_json" TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS "identity_accounts" (
  "person_id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "verifier" TEXT NOT NULL,
  "totp_secret" TEXT,
  "totp_last_step" INTEGER NOT NULL DEFAULT 0,
  "github_id" TEXT UNIQUE,
  "github_login" TEXT,
  "keys_json" TEXT,
  "recovery_hash" TEXT,
  "fails" INTEGER NOT NULL DEFAULT 0,
  "locked_until" INTEGER NOT NULL DEFAULT 0,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "identity_sessions" (
  "id" TEXT PRIMARY KEY,
  "person_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "device_class" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "method" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "revoked_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "identity_sessions_person" ON "identity_sessions" ("person_id");

CREATE TABLE IF NOT EXISTS "identity_challenges" (
  "id" TEXT PRIMARY KEY,
  "person_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "used_at" INTEGER,
  "tries" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "identity_codes" (
  "code_hash" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "purpose" TEXT,
  "expires_at" INTEGER NOT NULL,
  "used_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "identity_enrolments" (
  "id" TEXT PRIMARY KEY,
  "person_id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "used_at" INTEGER
);
