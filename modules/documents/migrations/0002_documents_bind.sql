-- documents: a template can be for one record type (record_type holds the type's key). A template with none is for any record: every blank is given by the caller.
-- New document on a record lists the templates of that record's type; the list filters on it.

ALTER TABLE documents_template ADD COLUMN record_type TEXT;
