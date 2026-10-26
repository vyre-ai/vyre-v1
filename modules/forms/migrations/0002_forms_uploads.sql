-- forms: files a visitor uploaded through a public form page, before the form is submitted.
-- A visitor never names a Space file: the upload route stores the file as the host, records it here against the form, the visitor (the act_anon_* actor, or the signed link's hash) and returns this row's id.
-- forms.submit accepts only an upload id made for the same form by the same visitor, once, within a day; the answer written to the record carries the file id.

CREATE TABLE IF NOT EXISTS forms_upload (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  token_hash TEXT,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
