// The vault gate: a locked Mine vault key is recognised, held at one prompt, and the call goes again once the key opens. Nobody is signed out.
import test from "node:test";
import assert from "node:assert/strict";
import { askVaultUnlock, isVaultLockedError, registerVaultPrompt, withVaultGate } from "./vault-gate.ts";

const locked = (): Error => Object.assign(new Error("Your vault key is locked. Sign in again to open your Mine items."), { details: { reason: "vault_locked" } });

test("a locked key is recognised by the daemon's reason or by its words, and nothing else is", () => {
  assert.equal(isVaultLockedError({ details: { reason: "vault_locked" } }), true);
  assert.equal(isVaultLockedError({ error: { details: { reason: "vault_locked" } } }), true);
  assert.equal(isVaultLockedError(new Error("Your vault key is locked on this computer.")), true);
  assert.equal(isVaultLockedError(new Error("You are signed out.")), false);
  assert.equal(isVaultLockedError(null), false);
});

test("a call that meets a locked key waits for the prompt, then goes again once; Cancel gives the original refusal", async () => {
  let sent = 0;
  const call = async (): Promise<string> => { sent += 1; if (sent === 1) throw locked(); return "saved"; };
  let asked = 0;
  registerVaultPrompt(async (unlock) => { asked += 1; await unlock("right"); return true; });
  assert.equal(await withVaultGate(call, async () => undefined)(), "saved");
  assert.deepEqual([sent, asked], [2, 1]);
  sent = 0;
  registerVaultPrompt(async () => false);
  await assert.rejects(withVaultGate(call, async () => undefined)(), (e: unknown) => e instanceof Error && /vault key is locked/.test(e.message));
  assert.equal(sent, 1, "a cancelled prompt does not send it again");
  registerVaultPrompt(null);
});

test("several calls that meet the lock share one prompt, and other errors pass straight through", async () => {
  let asked = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  registerVaultPrompt(async () => { asked += 1; await gate; return true; });
  const calls = [0, 0, 0].map(() => { let n = 0; return withVaultGate(async () => { n += 1; if (n === 1) throw locked(); return "ok"; }, async () => undefined)(); });
  await new Promise((r) => setTimeout(r, 5));
  release();
  assert.deepEqual(await Promise.all(calls), ["ok", "ok", "ok"]);
  assert.equal(asked, 1);
  await assert.rejects(withVaultGate(async () => { throw new Error("nope"); }, async () => undefined)(), /nope/);
  registerVaultPrompt(null);
  assert.equal(await askVaultUnlock(async () => undefined), false, "no prompt mounted: not asked");
});
