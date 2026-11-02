-- vault: who a subscription sign-in belongs to, and the handles that now lead to another account row. No value lives here.
-- vault_provider_identity: the account the provider named at sign-in (an id compared, a label shown, like an email). An empty identity means it was looked for and the sign-in names nobody
-- (a Claude setup token), so it is not looked for again.
-- vault_provider_alias: a handle of a sign-in that was folded into another row of the same account. Agents, chats and fallbacks that still name the old handle reach the row that kept the account.
CREATE TABLE IF NOT EXISTS vault_provider_identity (
  "providerId" TEXT PRIMARY KEY,
  "identity" TEXT NOT NULL,
  "label" TEXT,
  "at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_provider_alias (
  "handle" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
