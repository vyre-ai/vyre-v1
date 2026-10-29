-- forms: the author's own source beside the generated one. html is a template in a strict grammar (lib/form-source.ts): the author's markup and <vyre-field> markers where record-bound inputs go;
-- js is the author's script. Neither is ever written by Build, which edits only the fields.
ALTER TABLE forms_form ADD COLUMN html TEXT;
ALTER TABLE forms_form ADD COLUMN js TEXT;
