-- A connection made by hand can say which app hub it is (composio or pipedream) so every card and tool row can say "Runs through <hub>", and that it signs in with OAuth (the engine holds the token
-- sealed in its own table) instead of a static header. Both empty for an ordinary connection.
ALTER TABLE "agents_mcp_connections" ADD COLUMN "hub" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "auth" TEXT NOT NULL DEFAULT '';
