-- Ask the person (docs/ask-the-person.md): an agent asked the person it acts for to do what only that person may. The hold runs as the person (principal_*), and asked_by names the agent that asked,
-- as JSON {"kind","id"}, so the card, the events and the log say which agent it was. NULL for every other hold.
ALTER TABLE "gate_holds" ADD COLUMN "asked_by" TEXT;
