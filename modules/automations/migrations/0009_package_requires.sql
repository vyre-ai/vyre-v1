-- What an importer must connect before a package works: connection slots, Vault names and keys. Names only, never values.

ALTER TABLE "automations_packages" ADD COLUMN "requires" TEXT NOT NULL DEFAULT '{}';
