-- Whose turn an agent's message was written for, whoever paid (F51). The saved steps of the reply are theirs to read whole, and other readers are served the plain steps. Empty on messages saved before it was kept.
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
ALTER TABLE "chat_message" ADD COLUMN "askedBy" TEXT;
