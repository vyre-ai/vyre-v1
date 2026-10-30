-- memory: the trail, Trash and Archive, living pages, links with evidence, meaning vectors and upkeep runs (owner design 30 Oct 2026, rulings 4, 5 and 7).
-- New columns on memory_facts (trashed_at, trash_reason, trashed_by, prev_status, prev_valid_to, merged_into, touched_at, archived_at, archived_by) are added by ensure() because SQLite has no ADD COLUMN IF NOT EXISTS.
-- Person-layer text stays sealed to its owner in every table here: a personal page's notes, link labels and evidence live only in a `sealed` column, and no vector of personal text is kept.

-- Every change to a fact or a page, by a person, an agent or upkeep. Rows are never deleted or updated, and never hold content: an erase leaves one line with ids and the place only.
CREATE TABLE IF NOT EXISTS memory_trail (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  fact_id TEXT,
  page_id TEXT,
  layer TEXT,
  owner_ref TEXT,
  agent_id TEXT,
  project_id TEXT,
  actor TEXT NOT NULL,
  acting_for TEXT,
  actor_kind TEXT NOT NULL,
  source TEXT,
  reason TEXT,
  detail TEXT,
  run_id TEXT
);
CREATE INDEX IF NOT EXISTS memory_trail_fact ON memory_trail (fact_id, at);
CREATE INDEX IF NOT EXISTS memory_trail_page ON memory_trail (page_id, at);
CREATE INDEX IF NOT EXISTS memory_trail_at ON memory_trail (at);
CREATE INDEX IF NOT EXISTS memory_trail_action ON memory_trail (action, at);

-- A living page per subject: facts on top (rows above), free-form notes below, versioned.
CREATE TABLE IF NOT EXISTS memory_pages (
  page_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('person', 'agent', 'project', 'space')),
  owner_ref TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  subject_ref TEXT,
  subtitle TEXT,
  blurb TEXT,
  notes TEXT NOT NULL DEFAULT '',
  sealed TEXT,
  enc INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER,
  trash_reason TEXT,
  prev_status TEXT,
  touched_at INTEGER,
  archived_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_pages_subject ON memory_pages (layer, owner_ref, subject);
CREATE INDEX IF NOT EXISTS memory_pages_title ON memory_pages (title);

CREATE TABLE IF NOT EXISTS memory_page_versions (
  page_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  sealed TEXT,
  enc INTEGER NOT NULL DEFAULT 0,
  by_actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  reason TEXT,
  PRIMARY KEY (page_id, version)
);

-- [[links]] written in a page's notes: from page to page, with a label and the line it was written in (the evidence). label and evidence are sealed for a personal page.
CREATE TABLE IF NOT EXISTS memory_page_links (
  from_page TEXT NOT NULL,
  to_page TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  sealed TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (from_page, to_page, label)
);
CREATE INDEX IF NOT EXISTS memory_page_links_to ON memory_page_links (to_page);

-- [[links]] to a page written somewhere else: a chat, a run, a record. res_type/res_id name the resource a reader must be able to open to see the mention.
CREATE TABLE IF NOT EXISTS memory_mentions (
  page_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  message_id TEXT,
  res_type TEXT NOT NULL,
  res_id TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  PRIMARY KEY (page_id, source_kind, source_ref)
);
CREATE INDEX IF NOT EXISTS memory_mentions_source ON memory_mentions (source_kind, source_ref);

-- Meaning vectors of shared text only (agent, project and Space layers, notes, pages); never of a personal layer.
CREATE TABLE IF NOT EXISTS memory_vectors (
  doc_kind TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  model TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (doc_kind, doc_id, model)
);

-- One row per upkeep run, with what it did and what it cost (micro-dollars); the month sum is held against the monthly cap.
CREATE TABLE IF NOT EXISTS memory_upkeep_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  month TEXT NOT NULL,
  trigger_by TEXT NOT NULL,
  model_used INTEGER NOT NULL DEFAULT 0,
  merged INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  corrected INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  tidied INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  stopped TEXT
);
CREATE INDEX IF NOT EXISTS memory_upkeep_runs_month ON memory_upkeep_runs (month);

-- A question upkeep could not settle by itself: two values for one subject and field, or a fact that looks old. Answered with one click.
CREATE TABLE IF NOT EXISTS memory_questions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  fact_a TEXT NOT NULL,
  fact_b TEXT,
  layer TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  run_id TEXT,
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS memory_questions_status ON memory_questions (status, created_at);
