-- A guest invited from inside one chat (lane l-addsheet): the invite carries a guest role and one channel, and this row says the guest is scoped to it and how far (view, or reply). A scoped guest gets no Everyone group,
-- no home channel and no company mailbox: only that chat.
CREATE TABLE IF NOT EXISTS "members_invite_scope" (
  "invite_id" TEXT PRIMARY KEY,
  "level" TEXT NOT NULL
);
