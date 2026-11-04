-- Where a person's reading of a chat starts (lane l-addsheet). `fromAt` is the time a person was added to a private chat without "Include earlier messages": they read messages made at or after it, in the chat and in
-- the threads under it. Empty means all of it. Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
ALTER TABLE "chat_thread_member" ADD COLUMN "fromAt" INTEGER;
