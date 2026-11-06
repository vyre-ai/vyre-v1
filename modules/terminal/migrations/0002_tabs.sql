-- terminal: who made a session and for whom it is a tab (6 Nov). A workspace holds many tmux sessions, shown as tabs in the Terminal pane: the agent's own, one per helper or crew member it started, and
-- the ones a person opened. `kind` is agent, helper or person; `name` is the helper's name; `actor` is the principal that opened it (the agent, the helper's agent, or the person).
CREATE TABLE IF NOT EXISTS terminal_tabs (
  terminal_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT,
  actor TEXT NOT NULL,
  thread_id TEXT
);
