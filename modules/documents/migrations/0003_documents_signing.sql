-- documents: where the signers of a PDF made from a Vyre document sign. roles is the list of signer roles in signing order ({sign:role} in the text);
-- places is the list built-in signing takes (signer, kind, page, x, y, w, h in percent of the page). template_file_id and record_id say what the PDF was filled from, when it was.

CREATE TABLE IF NOT EXISTS documents_signing (
  file_id TEXT PRIMARY KEY,
  roles TEXT NOT NULL,
  places TEXT NOT NULL,
  template_file_id TEXT,
  record_id TEXT,
  made_at INTEGER NOT NULL
);
