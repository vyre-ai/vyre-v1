-- Watching: who else hears about a change (chats and channels, by their main thread) and the goal a watch counts toward.
ALTER TABLE "automations_watches" ADD COLUMN "tell_threads_json" TEXT;
ALTER TABLE "automations_watches" ADD COLUMN "goal_id" TEXT;
