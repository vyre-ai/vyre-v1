-- memory: bi-temporal facts, promotions, the note index, pointer bookkeeping and the graph (ARCH 6.10; spec 2.15, 4.15).
-- Every table is memory_*: ctx.db refuses anything else. A change to a fact closes the old row and adds a new one, so nothing is overwritten.
-- Person-layer rows (enc = 2) keep their text only in `sealed` (ctx.seal under the owner's scope); `text` stays empty, so a database dump holds no personal memory.

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('person', 'agent', 'project', 'space')),
  owner_ref TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  note_id TEXT,
  kind TEXT,
  text TEXT NOT NULL,
  sealed TEXT,
  enc INTEGER NOT NULL DEFAULT 0,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  learned_at INTEGER NOT NULL,
  closed_at INTEGER,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_link TEXT,
  source_person TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'current', 'closed', 'removed')),
  low_risk INTEGER NOT NULL DEFAULT 0,
  subject TEXT,
  replaces TEXT,
  promoted_from TEXT,
  promoted_by TEXT,
  promoted_at INTEGER
);
CREATE INDEX IF NOT EXISTS memory_facts_layer ON memory_facts (layer, owner_ref, status);
CREATE INDEX IF NOT EXISTS memory_facts_agent ON memory_facts (agent_id, status);
CREATE INDEX IF NOT EXISTS memory_facts_project ON memory_facts (project_id, status);
CREATE INDEX IF NOT EXISTS memory_facts_source ON memory_facts (source_person);
CREATE INDEX IF NOT EXISTS memory_facts_replaces ON memory_facts (replaces);
CREATE INDEX IF NOT EXISTS memory_facts_promoted ON memory_facts (promoted_from);

-- Where a fact came from: the chat, task, record or run (the exact link is also on the fact).
CREATE TABLE IF NOT EXISTS memory_fact_links (
  fact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  PRIMARY KEY (fact_id, kind, ref)
);

-- A request to move a fact to a shared layer; the task for the approver is task_id.
CREATE TABLE IF NOT EXISTS memory_promotions (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL,
  to_layer TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'undone')),
  requested_by TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  new_fact_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS memory_promotions_fact ON memory_promotions (fact_id, status);

-- Index of memory notes (Markdown files under the memory folders). Person-layer titles are sealed, bodies are never kept here.
CREATE TABLE IF NOT EXISTS memory_notes (
  note_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  sealed_title TEXT,
  layer TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  area TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_notes_file ON memory_notes (file_id);
CREATE INDEX IF NOT EXISTS memory_notes_agent ON memory_notes (agent_id, area);

-- What the pointer block already showed in a thread, and the message index it last ran for.
CREATE TABLE IF NOT EXISTS memory_pointer_log (
  thread_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, ref)
);
CREATE TABLE IF NOT EXISTS memory_pointer_state (
  thread_id TEXT PRIMARY KEY,
  last_idx INTEGER NOT NULL
);

-- The graph consumer's tables. res_type/res_id name the resource a viewer must be able to see to see the node.
CREATE TABLE IF NOT EXISTS memory_graph_nodes (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  layer TEXT,
  agent_id TEXT,
  project_id TEXT,
  res_type TEXT NOT NULL,
  res_id TEXT NOT NULL,
  link TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_graph_edges (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS memory_graph_edges_to ON memory_graph_edges (to_id);
-- [[Wiki links]] that name a title no node has yet; resolved whenever a node with that title arrives.
CREATE TABLE IF NOT EXISTS memory_graph_links (
  from_id TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (from_id, target)
);
CREATE TABLE IF NOT EXISTS memory_graph_seen (
  entity TEXT NOT NULL,
  ref TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (entity, ref)
);
CREATE TABLE IF NOT EXISTS memory_layouts (
  scope_key TEXT NOT NULL,
  person TEXT NOT NULL,
  node_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (scope_key, person, node_id)
);

-- MAP.md of each agent as the nightly job last wrote it (and the file it went to, when known).
CREATE TABLE IF NOT EXISTS memory_maps (
  agent_id TEXT PRIMARY KEY,
  file_id TEXT,
  body TEXT NOT NULL,
  lines INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
