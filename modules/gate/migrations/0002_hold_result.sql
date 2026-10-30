-- What an approved call answered (CHAT-DESIGN ruling 6): a chat turn parked at the Gate gets the call's answer when the person approves, so it goes on as if the call had never waited.
-- Kept on the hold, which only its requester and its approvers can read, and cut to 100 KB.
ALTER TABLE "gate_holds" ADD COLUMN "result" TEXT;
