-- One live template per key (lane r42-email-in). 0011 stays as it ran; this adds the rule. A reset leaves its old row behind (deleted_at set), never two live ones.
-- A database that already holds two live rows for a key keeps the newest and retires the older, then the index can be made.

UPDATE mail_template SET deleted_at = updated_at WHERE deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM mail_template n WHERE n.key = mail_template.key AND n.deleted_at IS NULL
  AND (n.updated_at > mail_template.updated_at OR (n.updated_at = mail_template.updated_at AND n.id > mail_template.id))
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_template__live_key ON mail_template (key) WHERE deleted_at IS NULL;
