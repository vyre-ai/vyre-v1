-- Whose meeting it is. A Meeting is shared by the people it belongs to: whoever brought it in (their calendar, their Meet or Teams call) and whoever else's calendar or call merged into it.
-- Everyone else in the Space does not see it. A meeting with no row here (older, or brought in by the server for the whole Space) stays visible to everyone.
CREATE TABLE IF NOT EXISTS meetings_watcher (
  "recordId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  PRIMARY KEY ("recordId", "personId")
);
