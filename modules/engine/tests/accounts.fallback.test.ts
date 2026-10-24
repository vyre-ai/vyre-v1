// Golden 10 (key failure fallback), the account part: a key fails, the backup key serves the turn, then nothing is left and the run waits in Needs you.
import test from "node:test";
import assert from "node:assert/strict";
import { onAccountFailure, resolveAccount } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, ResolveRequest } from "../../../agent/src/accounts/index.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({
  driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: false, ...o,
});
const DANA_KEY = row({ ref: "#Dana_Anthropic", mine: true, ownerId: "usr_dana" });
const TEAM_KEY = row({ ref: "#Team_Anthropic_Key" });
const BACKUP2 = row({ ref: "#Team_Backup_Key" });
const base = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", provider: "anthropic" }, backupRefs: ["#Team_Anthropic_Key"], policy: "any",
  accounts: [DANA_KEY, TEAM_KEY, BACKUP2], onServer: true, ...over,
});

test("golden 10: key failure uses the backup key, then the run waits in Needs you", () => {
  const trace: string[] = [];
  const req = base();

  const first = resolveAccount(req);
  trace.push(`resolve -> ${first.accountRef} (${first.reason})`);
  assert.deepEqual([first.accountRef, first.payer, first.reason], ["#Dana_Anthropic", "usr_dana", "starter"]);

  // 1. Dana's key is rejected mid-turn.
  const fell = onAccountFailure(req, "#Dana_Anthropic", { code: "provider.auth_failed" });
  trace.push(`provider.auth_failed on #Dana_Anthropic -> ${fell.action}`);
  assert.equal(fell.action, "use");
  if (fell.action !== "use") return;
  assert.equal(fell.accountRef, "#Team_Anthropic_Key");
  assert.deepEqual(fell.fallback, { kind: "backup_key", to: "#Team_Anthropic_Key" });
  assert.equal(fell.payer, "usr_dana", "usage is still logged against the person who asked");
  assert.equal(fell.unblock?.to, "usr_dana", "Dana hears that her own key broke");
  assert.equal(fell.unblock?.why, "failed");

  // 2. The backup fails too and there is no third account: the turn waits.
  const stuck = onAccountFailure({ ...req, accounts: [DANA_KEY, TEAM_KEY], unavailable: ["#Dana_Anthropic"] }, "#Team_Anthropic_Key", { code: "provider.rate_limited" });
  trace.push(`provider.rate_limited on #Team_Anthropic_Key -> ${stuck.action}`);
  assert.equal(stuck.action, "wait");
  if (stuck.action !== "wait") return;
  assert.equal(stuck.unblock.kind, "unblock");
  assert.equal(stuck.unblock.to, "usr_dana", "the card lands in the starter's Needs you");
  assert.ok(stuck.unblock.next.length > 0);
  assert.deepEqual(stuck.tried.map((t) => [t.ref, t.used]), [["#Dana_Anthropic", false], ["#Team_Anthropic_Key", false]]);

  assert.deepEqual(trace, [
    "resolve -> #Dana_Anthropic (starter)",
    "provider.auth_failed on #Dana_Anthropic -> use",
    "provider.rate_limited on #Team_Anthropic_Key -> wait",
  ]);
});

test("a third account keeps the turn alive after the backup also fails", () => {
  const req = base({ backupRefs: ["#Team_Anthropic_Key", "#Team_Backup_Key"] });
  const second = onAccountFailure({ ...req, unavailable: ["#Dana_Anthropic"] }, "#Team_Anthropic_Key", { code: "provider.rate_limited" });
  assert.equal(second.action === "use" && second.accountRef, "#Team_Backup_Key");
});

test("errors that every account would hit the same way are surfaced, not retried on another key", () => {
  for (const code of ["provider.context_too_long", "provider.content_filtered", "provider.bad_response", "validation.bad_input", "permission.provider_label"]) {
    assert.deepEqual(onAccountFailure(base(), "#Dana_Anthropic", { code }), { action: "surface", code });
  }
});

test("a wake-up that finds the starter's subscription expired posts an Unblock and falls back to the backup key", () => {
  const sub = row({ ref: "sub_dana_claude", kind: "subscription", driver: "claude_code", mine: true, ownerId: "usr_dana", status: "expired", spaceMayUse: true });
  const r = resolveAccount(base({ trigger: "wake", accounts: [sub, TEAM_KEY] }));
  assert.deepEqual([r.accountRef, r.reason, r.allowed], ["#Team_Anthropic_Key", "backup_key", true]);
  assert.equal(r.unblock?.to, "usr_dana");
  assert.equal(r.unblock?.why, "expired");
  assert.equal(r.unblock?.ref, "sub_dana_claude");
  assert.deepEqual(r.unblock?.next.map((n) => n.kind), ["reconnect", "use_backup_key"]);
});

test("a task uses the step key, then its backup, else it waits in the owner's Needs you", () => {
  const task = base({ trigger: "task", stepKey: "#Team_Anthropic_Key", backupRefs: ["#Team_Backup_Key"] });
  assert.deepEqual([resolveAccount(task).accountRef, resolveAccount(task).reason], ["#Team_Anthropic_Key", "step_key"]);
  const failed = onAccountFailure(task, "#Team_Anthropic_Key", { code: "provider.auth_failed" });
  assert.equal(failed.action === "use" && failed.accountRef, "#Team_Backup_Key");
  assert.equal(resolveAccount({ ...task, unavailable: ["#Team_Anthropic_Key", "#Team_Backup_Key"] }).reason, "none");
  const none = resolveAccount(base({ trigger: "task", backupRefs: [], accounts: [] }));
  assert.equal(none.accountRef, null);
  assert.equal(none.allowed, false);
  assert.equal(none.unblock?.why, "no_account");
  assert.equal(none.unblock?.to, "usr_dana");
});
