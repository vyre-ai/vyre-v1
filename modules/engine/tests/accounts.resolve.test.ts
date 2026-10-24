// Account resolution (ARCH 6.4, spec 4.14): who pays, which account, and the rules that keep one person's account out of another's turn.
import test from "node:test";
import assert from "node:assert/strict";
import { providerOfModel, resolveAccount, serverMayUse, skipReason } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, ResolveRequest } from "../../../agent/src/accounts/index.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({
  driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: false, ...o,
});
const dana = row({ ref: "#Dana_Anthropic", mine: true, ownerId: "usr_dana" });
const danaSub = row({ ref: "sub_dana", kind: "subscription", driver: "claude_code", mine: true, ownerId: "usr_dana", spaceMayUse: true });
const sam = row({ ref: "#Sam_Anthropic", mine: true, ownerId: "usr_sam" });
const team = row({ ref: "#Team_Anthropic_Key" });
const base = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", provider: "anthropic" }, backupRefs: [], policy: "any", accounts: [dana, sam, team], onServer: true, ...over,
});
const pick = (r: ReturnType<typeof resolveAccount>) => [r.accountRef, r.payer, r.reason];

test("the starter's own account pays for a plain message", () => {
  assert.deepEqual(pick(resolveAccount(base())), ["#Dana_Anthropic", "usr_dana", "starter"]);
});

test("whoever steers pays for the turn their message causes, on their own account", () => {
  assert.deepEqual(pick(resolveAccount(base({ steerer: "usr_sam" }))), ["#Sam_Anthropic", "usr_sam", "steerer"]);
  assert.deepEqual(pick(resolveAccount(base({ steerer: "usr_dana" }))), ["#Dana_Anthropic", "usr_dana", "starter"]);
});

test("a wake-up runs on the starter's account whoever last spoke; a routine on its setter's", () => {
  assert.deepEqual(pick(resolveAccount(base({ trigger: "wake", steerer: "usr_sam" }))), ["#Dana_Anthropic", "usr_dana", "starter"]);
  assert.deepEqual(pick(resolveAccount(base({ trigger: "routine", routineOwner: "usr_sam" }))), ["#Sam_Anthropic", "usr_sam", "starter"]);
});

test("a subscription sign-in is preferred over a key of the same person", () => {
  assert.equal(resolveAccount(base({ accounts: [dana, danaSub] })).accountRef, "sub_dana");
});

test("a team key: the agent points at it, usage is logged against the asker", () => {
  const r = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Team_Anthropic_Key" }, steerer: "usr_sam" }));
  assert.deepEqual(pick(r), ["#Team_Anthropic_Key", "usr_sam", "steerer"]);
});

test("a thread pin beats the agent's setting; a pin to someone else's Mine account is refused and the chain moves on", () => {
  assert.equal(resolveAccount(base({ threadAccountRef: "#Team_Anthropic_Key" })).accountRef, "#Team_Anthropic_Key");
  const r = resolveAccount(base({ threadAccountRef: "#Sam_Anthropic" }));
  assert.equal(r.accountRef, "#Dana_Anthropic");
  assert.deepEqual(r.tried[0], { ref: "#Sam_Anthropic", used: false, why: "not_yours" });
});

test("a signed-out or failing account is skipped, and its owner gets an Unblock even when a backup serves the turn", () => {
  const r = resolveAccount(base({ accounts: [{ ...dana, status: "failed" }, team], backupRefs: ["#Team_Anthropic_Key"] }));
  assert.deepEqual(pick(r), ["#Team_Anthropic_Key", "usr_dana", "backup_key"]);
  assert.equal(r.unblock?.why, "failed");
  assert.equal(r.unblock?.to, "usr_dana");
  const untested = resolveAccount(base({ accounts: [{ ...dana, status: "untested" }] }));
  assert.equal(untested.accountRef, "#Dana_Anthropic");
  assert.equal(untested.unblock, undefined);
});

test("Company only: personal keys and subscriptions are out, shared keys stay", () => {
  const r = resolveAccount(base({ policy: "company", accounts: [dana, danaSub, team], backupRefs: ["#Team_Anthropic_Key"] }));
  assert.deepEqual(pick(r), ["#Team_Anthropic_Key", "usr_dana", "backup_key"]);
  assert.deepEqual(r.tried.filter((t) => !t.used).map((t) => t.why), ["policy_company", "policy_company"]);
  const none = resolveAccount(base({ policy: "company", accounts: [dana, danaSub] }));
  assert.equal(none.reason, "none");
  assert.equal(none.unblock?.why, "policy");
});

test("a server run needs the standing switch for a subscription; the person's own device does not", () => {
  const off = { ...danaSub, spaceMayUse: false };
  assert.equal(resolveAccount(base({ accounts: [off], onServer: true })).accountRef, null);
  assert.equal(skipReason(off, base(), "usr_dana"), "space_may_not_use");
  assert.equal(resolveAccount(base({ accounts: [off], onServer: false })).accountRef, "sub_dana");
});

test("an agent that needs another provider does not borrow the wrong account", () => {
  assert.equal(resolveAccount(base({ agent: { accountPolicy: "asker", provider: "openai" } })).accountRef, null);
  assert.equal(resolveAccount(base({ agent: { accountPolicy: "asker" } })).accountRef, "#Dana_Anthropic");
});

test("nothing usable: the run waits, the owner's Needs you gets an Unblock, and the attempts are listed", () => {
  const r = resolveAccount(base({ accounts: [] }));
  assert.deepEqual([r.accountRef, r.payer, r.reason, r.allowed], [null, null, "none", false]);
  assert.deepEqual(r.unblock, { to: "usr_dana", kind: "unblock", ref: null, why: "no_account", next: [{ kind: "open_settings", label: "Open AI settings" }] });
});

test("serverMayUse: only the owner's own turn or routine, and only with the switch on", () => {
  assert.equal(serverMayUse({ ownerId: "usr_dana", spaceMayUse: true }, { startedBy: "usr_dana" }), true);
  assert.equal(serverMayUse({ ownerId: "usr_dana", spaceMayUse: true }, { routineOwner: "usr_dana" }), true);
  assert.equal(serverMayUse({ ownerId: "usr_dana", spaceMayUse: true }, { startedBy: "usr_sam" }), false);
  assert.equal(serverMayUse({ ownerId: "usr_dana", spaceMayUse: false }, { startedBy: "usr_dana" }), false);
  assert.equal(serverMayUse({ ownerId: null, spaceMayUse: true }, { startedBy: "usr_dana" }), false);
});

test("providerOfModel reads router slugs and model families", () => {
  assert.equal(providerOfModel("anthropic/claude-sonnet-5-5"), "anthropic");
  assert.equal(providerOfModel("claude-sonnet-5-5"), "anthropic");
  assert.equal(providerOfModel("gpt-5"), "openai");
  assert.equal(providerOfModel("gemini-3-pro"), "google");
  assert.equal(providerOfModel("grok-4"), "xai");
  assert.equal(providerOfModel("llama-local"), undefined);
  assert.equal(providerOfModel(undefined), undefined);
});
