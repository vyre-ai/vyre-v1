-- A setup offer for a Mine item belongs to the person who saved it; an offer for a shared item (owner empty) is for the Space. No key and no field value.
ALTER TABLE "automations_connector_offers" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';
