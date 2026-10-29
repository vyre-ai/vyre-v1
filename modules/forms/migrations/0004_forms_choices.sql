-- forms: the record and person choices a publisher has approved for a public relation or person question. A visitor sees only `label` (the target's display title or a member's display name) under an opaque `key`;
-- `ref_id` (a record id or a person id) never leaves the Space. `set_by` is the publisher whose authority is asked again at every submit.
CREATE TABLE IF NOT EXISTS forms_choice (
  form_id TEXT NOT NULL,
  field TEXT NOT NULL,
  key TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (form_id, key)
);
CREATE UNIQUE INDEX IF NOT EXISTS forms_choice__ref ON forms_choice (form_id, field, ref_id);
