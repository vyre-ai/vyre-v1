-- Whose money a node spends (r42-runtime): "space" when its turns run on an account of the Space, "own" when on the person's own, none yet when no model call has said. A limit on work that spends the Space's money
-- is raised only by someone who may spend it (the permission the Space's own AI spend settings use).
ALTER TABLE runs_node ADD COLUMN spend_scope TEXT;
