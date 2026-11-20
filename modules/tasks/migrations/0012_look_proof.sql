-- Living tasks (lane r42-alive): what the daily look verified for a card row. look is 'done' only when the quoted words were found in a real, later message of the task's own chat that everyone on the task can read;
-- quote is those words, by who wrote them and at when it was written. The card draws "Looks done" from this and never from text a model wrote.
ALTER TABLE "tasks_ask" ADD COLUMN "look" TEXT;
ALTER TABLE "tasks_ask" ADD COLUMN "quote" TEXT;
ALTER TABLE "tasks_ask" ADD COLUMN "quote_by" TEXT;
ALTER TABLE "tasks_ask" ADD COLUMN "quote_at" INTEGER;
