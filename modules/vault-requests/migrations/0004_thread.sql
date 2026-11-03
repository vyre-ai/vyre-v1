-- The newest chat an agent asked in, where it carries on once the key is in. Read from here so the person the key was asked for, who holds none of the managers' cards, can add it from their own
-- card (owner ruling 3 Nov). Empty for a request made outside a chat, and for one made before this column; those are read back from the managers' cards as before.
ALTER TABLE "vault_requests_requests" ADD COLUMN "thread_id" TEXT;
