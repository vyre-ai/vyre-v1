import test from "node:test";
import assert from "node:assert/strict";
import { payLine } from "./paid.ts";
import { resolveAccount } from "./resolve.ts";
import type { AccountRow, ResolveRequest } from "./types.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({ driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: true, ...o });
const OWN = row({ ref: "#Dana", mine: true, ownerId: "usr_dana", spaceMayUse: false });
const TEAM = row({ ref: "#Team", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true });
const base = (o: Partial<ResolveRequest> = {}): ResolveRequest => ({ starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", agentId: "agt_1" }, backupRefs: [], policy: "any", accounts: [OWN, TEAM], onServer: true, ...o });

test("the line says who paid and why, from the rule that chose the account", () => {
  assert.equal(payLine({ kind: "api_key" }), "The asker's own key");
  assert.equal(payLine({ kind: "subscription" }), "The asker's own sign-in");
  assert.match(payLine({ via: "chat_key", kind: "api_key" }), /^The agent's Chat key/);
  assert.equal(payLine({ via: "space", kind: "api_key", fellBack: true }), "A Space AI account, after another could not pay");
});

test("Chat key off: the resolver's own pick is the asker's; on: it says chat_key", () => {
  assert.equal(resolveAccount(base()).via, "own");
  const on = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Team", agentId: "agt_1" } }));
  assert.deepEqual([on.accountRef, on.via], ["#Team", "chat_key"]);
});
