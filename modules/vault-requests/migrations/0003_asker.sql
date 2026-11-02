-- The person an agent asked for a key on behalf of (3 Nov live walk: a member's own card vanished, because the request was the agent's and only it and the managers could read it). Empty when a person
-- asked for themselves, who is then the requester.
ALTER TABLE "vault_requests_requests" ADD COLUMN "asker_id" TEXT;
