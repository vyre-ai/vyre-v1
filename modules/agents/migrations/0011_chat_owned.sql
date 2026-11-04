-- An agent a chat made for itself (lane l-addsheet): a teammate whose home is one chat or channel instead of a project. The Agents page leaves it out, and the chat removes it with itself.
ALTER TABLE "agents_agent" ADD COLUMN "threadId" TEXT;
