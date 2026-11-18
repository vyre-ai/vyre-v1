-- The periodic job that ends exceptions (modules/access/handlers/exceptions.ts lapseDue) asks for the grants whose end has come: an index on the end time answers that without reading the table.
-- Only grants that end at some time are in it (most do not). The index is on a column the stamp triggers already watch, so it changes nothing about what the store reads.
CREATE INDEX IF NOT EXISTS "access_grants_expires" ON "access_grants" ("expiresAt") WHERE "expiresAt" IS NOT NULL;
