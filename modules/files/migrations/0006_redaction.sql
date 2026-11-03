-- files: Redaction for AI (owner 3 Nov, rc.20). Agent access on folders and files, the redaction and highlight layer of a file, its review, and agents' requests to read it.
-- None of this changes a file or its provider: it is Vyre's own layer, placed on one version and carried to the next (lib/redact.ts reanchor).

-- Agent access set on a folder or a file (value on, redact or off). No row: the folder above decides; the Space default is on.
CREATE TABLE IF NOT EXISTS files_agent_access (
  target_kind TEXT NOT NULL,          -- folder | file
  target_id TEXT NOT NULL,
  value TEXT NOT NULL,                -- on | redact | off
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id)
);

-- One mark: a redaction or a highlight, on a file (or a piece of a folder's or file's name: shape name, target the folder or file).
CREATE TABLE IF NOT EXISTS files_mark (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,            -- the file id; a folder id for a name piece of a folder
  version INTEGER NOT NULL,           -- the file version the mark is placed on
  kind TEXT NOT NULL,                 -- redact | highlight
  shape TEXT NOT NULL,                -- span | box | range | name
  text TEXT,                          -- what it covers (the words under a box or a range when known)
  occurrence INTEGER,                 -- which match of text; NULL is every match
  page INTEGER,
  box TEXT,                           -- JSON {x,y,w,h}, fractions of the page or picture
  range_from REAL,                    -- seconds, for audio and video
  range_to REAL,
  label TEXT,                         -- what a detector or a person called it (Name, SSN); agents never see it
  by TEXT NOT NULL,                   -- the person, or for an agent the person it acted for
  by_agent TEXT,                      -- the agent that made it, when one did
  via TEXT,                           -- check (a detector suggestion accepted) | select | box | range | name
  at INTEGER NOT NULL,
  unplaced INTEGER NOT NULL DEFAULT 0,  -- 1: a new version took its text away; the file needs review until it is placed or dropped
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX IF NOT EXISTS files_mark__target ON files_mark (target_id);

-- Review of a file in a Redacted folder (or one whose redactions a new version moved). reviewed holds for version; needs is set when a new version leaves redactions unplaced.
CREATE TABLE IF NOT EXISTS files_review (
  file_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,                -- reviewed | needs
  by TEXT,
  at INTEGER NOT NULL
);

-- An agent asked to read a file it may not read yet ("Redact before I can read"). Done (files.review) answers every waiting one and wakes the agent.
CREATE TABLE IF NOT EXISTS files_redact_request (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  agent TEXT,                         -- the agent, when the call said which
  asker TEXT,                         -- the person it acts for
  thread TEXT,
  task_id TEXT,
  state TEXT NOT NULL,                -- waiting | done | later
  at INTEGER NOT NULL,
  done_by TEXT,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS files_redact_request__file ON files_redact_request (file_id, state);
