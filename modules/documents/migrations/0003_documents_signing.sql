-- documents: where the signers of a PDF made from a Vyre document sign. roles is the list of signer roles in signing order ({sign:role} in the text);
-- places is the list built-in signing takes (signer, kind, page, x, y, w, h in percent of the page). version_id is the version of the PDF the places belong to (a later version has its own page, so the places are not trusted for it); template_file_id and record_id say what the PDF was filled from, when it was.

CREATE TABLE IF NOT EXISTS documents_signing (
  file_id TEXT PRIMARY KEY,
  roles TEXT NOT NULL,
  places TEXT NOT NULL,
  version_id TEXT,
  template_file_id TEXT,
  record_id TEXT,
  made_at INTEGER NOT NULL
);
