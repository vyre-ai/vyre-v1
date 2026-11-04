import test from "node:test";
import assert from "node:assert/strict";
import { payLine, splitPaid } from "./paid.ts";
import { resolveAccount } from "./resolve.ts";
import type { AccountRow, ResolveRequest } from "./types.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({ driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: true, ...o });
const OWN = row({ ref: "#Dana", mine: true, ownerId: "usr_dana", spaceMayUse: false });
const TEAM = row({ ref: "#Team", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true });
const base = (o: Partial<ResolveRequest> = {}): ResolveRequest => ({ starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", agentId: "agt_1" }, backupRefs: [], policy: "any", accounts: [OWN, TEAM], onServer: true, ...o });

test("the line is the account's name and whose it is, from the rule that chose it", () => {
  assert.equal(payLine({ name: "OpenCode Go", kind: "api_key", shared: true, via: "space" }), "OpenCode Go \u00b7 Space account");
  assert.equal(payLine({ name: "Claude Code", kind: "subscription" }), "Claude Code \u00b7 your sign-in");
  assert.equal(payLine({ name: "Anthropic key", kind: "api_key", via: "own" }), "Anthropic key \u00b7 your key");
  assert.equal(payLine({ name: "Anthropic key", via: "chat_key", kind: "api_key", agentName: "Intake" }), "Anthropic key \u00b7 Intake's own account");
  assert.equal(payLine({ name: "OpenCode Go", kind: "api_key", via: "space", shared: true, fellBack: true, cappedFrom: "#Team_Credits" }), "OpenCode Go \u00b7 Backup after #Team_Credits hit its cap");
  assert.equal(payLine({ kind: "api_key", via: "backup", shared: true }), "Space backup account");
  assert.deepEqual(splitPaid("OpenCode Go \u00b7 Space account"), { name: "OpenCode Go", who: "Space account" });
  assert.equal(splitPaid("The asker's own key"), null);
});

test("Chat key off: the resolver's own pick is the asker's; on: it says chat_key", () => {
  assert.equal(resolveAccount(base()).via, "own");
  const on = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Team", agentId: "agt_1" } }));
  assert.deepEqual([on.accountRef, on.via], ["#Team", "chat_key"]);
});
