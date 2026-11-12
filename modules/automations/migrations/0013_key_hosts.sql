-- The hosts a person approved for one Vault key: a test read (and what follows) may send that key only to a host listed here, or to the host of the item's own saved address. One row per item and host.
CREATE TABLE IF NOT EXISTS "automations_key_hosts" (
  "item_id" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("item_id", "host")
);
