-- A conversation made from a person's private mailbox (a member's own Gmail or Outlook in a Team Space): it has no record above it, belongs to that person alone, and is never merged with a
-- conversation made from shared mail or matched to a record. The row is the mark; the conversation's own row stays the same shape.
CREATE TABLE IF NOT EXISTS inbox_private (
  "conversationId" TEXT PRIMARY KEY
);
