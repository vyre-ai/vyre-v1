-- Living tasks (lane r42-alive): when someone who may answer the card first had a row in front of them. A row archives itself for silence only a week after that, never before anyone saw it.
ALTER TABLE "tasks_ask" ADD COLUMN "seen_at" INTEGER;
