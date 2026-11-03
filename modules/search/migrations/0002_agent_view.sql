-- search: what an agent may read of a document, when that differs from what a person reads (Redaction for AI). A person's search uses search_docs as it is, so a person who may read the
-- whole file still finds a redacted word in it; an agent's search matches and quotes only this row: [REDACTED] where a part is hidden, no body while the file waits for review, and
-- withheld = 1 when agents may not see the file at all. One row per document rowid, gone when the document is.
CREATE TABLE IF NOT EXISTS search_agent_docs (
  n INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  path TEXT,
  body TEXT NOT NULL,
  withheld INTEGER NOT NULL DEFAULT 0
);
