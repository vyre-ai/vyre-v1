-- A request an outside agent made (docs/ask-the-person.md): fulfilled, the key's name goes back to it and nothing else. It gets no Use on the item, so a key never becomes a standing grant
-- for an agent outside Vyre. 1 for those, 0 for every other request.
ALTER TABLE "vault_requests_requests" ADD COLUMN "handle_only" INTEGER NOT NULL DEFAULT 0;
