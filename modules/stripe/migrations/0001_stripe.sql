-- stripe. One log, so a webhook Stripe sends twice (it retries until it gets a 2xx) is applied once: the Stripe event id and what it was about.

CREATE TABLE IF NOT EXISTS stripe_event_log (
  "eventId" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
