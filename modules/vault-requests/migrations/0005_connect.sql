-- The connect card (b-connect, 14 Nov 2026): a request can be for a service (a connector) rather than for a named key. The same row carries it, so the card, the agent's wait and the admin's ask are one thing.
-- service: the connector's key; empty for a plain key request.
ALTER TABLE "vault_requests_requests" ADD COLUMN "service" TEXT;
-- Where a waiting connect card stands, stored only for what the server learned by trying: wrong (the app refused the key), offline (the app could not be reached), asked (an admin was asked). Empty otherwise.
ALTER TABLE "vault_requests_requests" ADD COLUMN "phase" TEXT;
-- The admin who was asked to connect it, and when.
ALTER TABLE "vault_requests_requests" ADD COLUMN "admin_id" TEXT;
ALTER TABLE "vault_requests_requests" ADD COLUMN "admin_asked_at" INTEGER;
-- The connection this request made, and what the test read, said in a few words. Names, never a value.
ALTER TABLE "vault_requests_requests" ADD COLUMN "connection_id" TEXT;
ALTER TABLE "vault_requests_requests" ADD COLUMN "tested" TEXT;
