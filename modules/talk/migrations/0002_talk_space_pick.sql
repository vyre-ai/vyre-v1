-- talk: the Space keeps one key per provider and picks which provider covers people. Until now the one key row was the pick.

CREATE TABLE IF NOT EXISTS talk_space_pick (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL
);

INSERT OR IGNORE INTO talk_space_pick ("id", "provider", "enabled") SELECT 'space', "provider", "enabled" FROM talk_space WHERE "id" = 'space';
UPDATE talk_space SET "id" = "provider" WHERE "id" = 'space';
