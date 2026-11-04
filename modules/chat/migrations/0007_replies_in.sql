-- Where agents answer in one chat (lane l-threadreplies). `repliesIn` 1 means agents reply in the thread under the message that asked them, 0 means in the chat itself, empty means the default: on for a project or channel main chat, off for every other chat.
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
ALTER TABLE "chat_thread" ADD COLUMN "repliesIn" INTEGER;
