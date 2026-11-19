-- How often in a row a sending domain failed its check (DNS, provider or mail server), so one bad moment never stops a domain sending: it stops being "verified" on the second failure in a row, and a pass clears the count.
CREATE TABLE IF NOT EXISTS mail_domain_watch (
  "domainId" TEXT PRIMARY KEY,
  strikes INTEGER NOT NULL,
  why TEXT,
  "wasDefault" INTEGER NOT NULL DEFAULT 0,
  "checkedAt" INTEGER NOT NULL
);
