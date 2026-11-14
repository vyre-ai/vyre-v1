-- terminal: the Unix users of the people who use a shared agent without owning it (14 Nov). Each such person has one uid for the whole Space (20000 to 20999, named u<uid> in the workspace image), the same in
-- every workspace, so their folder is found again after a sleep, a restart and an update. A uid that someone had made the folder of first (a squatter) is burned and never used. terminal_person_places records
-- where a person's folder was made, so a leaver's cleanup touches only those workspaces; terminal_person_gone starts the Trash clock when a person leaves the Space (member.removed): their folder is unreachable at
-- once and removed after the Space's Trash retention, unless they are back first.
CREATE TABLE IF NOT EXISTS terminal_people (
  person TEXT PRIMARY KEY,
  uid INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS terminal_uid_burned (
  uid INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS terminal_person_places (
  agent_id TEXT NOT NULL,
  person TEXT NOT NULL,
  PRIMARY KEY (agent_id, person)
);
CREATE TABLE IF NOT EXISTS terminal_person_gone (
  person TEXT PRIMARY KEY,
  gone_at INTEGER NOT NULL
)
