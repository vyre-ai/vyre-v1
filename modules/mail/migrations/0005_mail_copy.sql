-- Each mailbox's own copy of a message: the provider's id and thread key in that mailbox. Gmail thread ids and Graph message and conversation ids are per mailbox, so a reply
-- from a mailbox needs that mailbox's ids (Gmail threadId; Graph createReply on the copy), and a provider thread whose first message joined another thread (a reply from someone
-- else, linked by In-Reply-To or References) keeps every later message in that same thread.
CREATE TABLE IF NOT EXISTS mail_copy (
  "messageId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  source TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "threadKey" TEXT,
  PRIMARY KEY ("messageId", "mailboxId")
);
CREATE INDEX IF NOT EXISTS mail_copy__thread ON mail_copy ("mailboxId", source, "threadKey");
