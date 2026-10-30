-- Connectors written by hand or by an agent. The definition holds hosts, an auth map and request shapes. It holds no key and no Vault value.
-- vault_handle is the name of a Vault item such as #Stripe. The value stays in the Vault.
CREATE TABLE IF NOT EXISTS "automations_connectors" (
  "app" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "def" TEXT NOT NULL,
  "vault_handle" TEXT,
  "owner_kind" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "fingerprints" TEXT NOT NULL DEFAULT '{}',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "published_at" INTEGER,
  "published_by" TEXT,
  "deleted_at" INTEGER
);

-- A Vault item and a host that a person has allowed to receive that item's key. An agent cannot send a key to a new host on its own.
CREATE TABLE IF NOT EXISTS "automations_connector_hosts" (
  "item" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "trusted_by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("item", "host")
);

-- Where a polling trigger is: its cursor, the ids it has handled, and when it may try again.
CREATE TABLE IF NOT EXISTS "automations_connector_poll" (
  "app" TEXT NOT NULL,
  "trigger_key" TEXT NOT NULL,
  "cursor" TEXT,
  "seen" TEXT NOT NULL DEFAULT '[]',
  "primed" INTEGER NOT NULL DEFAULT 0,
  "fails" INTEGER NOT NULL DEFAULT 0,
  "next_at" INTEGER NOT NULL DEFAULT 0,
  "last_at" INTEGER,
  "last_status" INTEGER,
  "last_error" TEXT,
  "fired" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("app", "trigger_key")
);

-- The secret in the address of a webhook trigger. Rotating it replaces the row.
CREATE TABLE IF NOT EXISTS "automations_connector_hooks" (
  "app" TEXT NOT NULL,
  "trigger_key" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "rotated_at" INTEGER NOT NULL,
  "last_delivery_at" INTEGER,
  PRIMARY KEY ("app", "trigger_key")
);

-- A delivery to a webhook trigger that carried an id. A repeat of the same id is dropped.
CREATE TABLE IF NOT EXISTS "automations_connector_deliveries" (
  "app" TEXT NOT NULL,
  "trigger_key" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("app", "trigger_key", "delivery_id")
);
