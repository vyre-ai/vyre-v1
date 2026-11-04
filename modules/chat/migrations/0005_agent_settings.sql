-- How and when an agent answers in one chat (lane l-addsheet). Kept with the agent's row in the chat: `respond` is always, topics or hours, `topics` a few words, `hoursFrom` and `hoursTo` are HH:MM,
-- `style` is short or full, `quiet` 1 means Listening (reads, never posts unless poked), `owned` 1 means the chat made the agent for itself and removes it with the chat, `grants` lists what an outside agent was given for this chat (JSON), taken back when it leaves.
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
ALTER TABLE "chat_thread_agent" ADD COLUMN "respond" TEXT;
ALTER TABLE "chat_thread_agent" ADD COLUMN "topics" TEXT;
ALTER TABLE "chat_thread_agent" ADD COLUMN "hoursFrom" TEXT;
ALTER TABLE "chat_thread_agent" ADD COLUMN "hoursTo" TEXT;
ALTER TABLE "chat_thread_agent" ADD COLUMN "style" TEXT;
ALTER TABLE "chat_thread_agent" ADD COLUMN "quiet" INTEGER;
ALTER TABLE "chat_thread_agent" ADD COLUMN "owned" INTEGER;
ALTER TABLE "chat_thread_agent" ADD COLUMN "grants" TEXT;
