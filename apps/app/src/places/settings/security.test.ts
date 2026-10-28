import test from "node:test";
import assert from "node:assert/strict";
import { makeBundle, openBundle, wipe } from "../../../../../client/src/crypto/keys.ts";
import { changeOwnPassword } from "./security.ts";

test("changing a password rewraps the same person key and retains recovery, private and Space keys", async () => {
  const original = await makeBundle("old-test-password", "fixture-recovery-code");
  const { personKey: originalKey, ...wrapped } = original;
  const keys = { ...wrapped, spaceKeys: [] };
  let changed: { keys: typeof keys; currentPassword: string; newPassword: string } | undefined;
  const calls: string[] = [];
  try {
    await changeOwnPassword(async (cap, input) => {
      calls.push(cap);
      if (cap === "identity.keys_get") return { keys };
      changed = input as typeof changed;
      return { ok: true };
    }, "old-test-password", "new-test-password");
    assert.deepEqual(calls, ["identity.keys_get", "identity.change_password"]);
    assert.ok(changed);
    assert.equal(changed.keys.personKeyByRecovery, keys.personKeyByRecovery);
    assert.equal(changed.keys.privateKeyWrapped, keys.privateKeyWrapped);
    assert.deepEqual(changed.keys.spaceKeys, []);
    const opened = await openBundle("new-test-password", changed.keys);
    assert.deepEqual(opened.personKey, originalKey);
    wipe(opened.personKey); wipe(opened.privateKey);
  } finally { wipe(originalKey); }
});

test("an incorrect current password never writes a replacement key bundle", async () => {
  const made = await makeBundle("old-test-password", "fixture-recovery-code");
  const { personKey, ...keys } = made;
  const calls: string[] = [];
  try {
    await assert.rejects(changeOwnPassword(async (cap) => { calls.push(cap); return { keys }; }, "wrong-test-password", "new-test-password"));
    assert.deepEqual(calls, ["identity.keys_get"]);
  } finally { wipe(personKey); }
});
