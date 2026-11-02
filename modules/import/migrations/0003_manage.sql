-- An imported session is the owner's to manage in Vyre: a title they gave it, the Archived list, and delete. The copied transcript stays immutable: a rename sets shownTitle and leaves the
-- source title alone. A delete drops the messages and tool calls and keeps only a tombstone (ids and deletedAt), so a later import of the same source session skips it and it does not come back.
ALTER TABLE "import_conversation" ADD COLUMN "shownTitle" TEXT;
ALTER TABLE "import_conversation" ADD COLUMN "archivedAt" INTEGER;
ALTER TABLE "import_conversation" ADD COLUMN "deletedAt" INTEGER;
