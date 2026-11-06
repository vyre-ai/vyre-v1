// The person key stays on the device for the signed-in session (owner ruling 6 Nov: signed in means unlocked). Sealed with a non-extractable WebCrypto key, restored after a relaunch with no password,
// removed at sign-out, and handed again to a node that restarted.
import test from "node:test";
import assert from "node:assert/strict";
import { sealKey, unsealKey } from "./key-seal.ts";
import type { SealRecord, SealStore } from "./key-seal.ts";
import { forgetKey, keepKey, keyIsKept, leaveMemory, rehandKey, restoreKey, useSealStore } from "./key-keeper.ts";

const memory = (): SealStore & { row: SealRecord | null } => {
  const s = { row: null as SealRecord | null, get: async () => s.row, put: async (r: SealRecord) => { s.row = r; }, remove: async () => { s.row = null; } };
  return s;
};
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

test("a sealed key opens again, never reads back as the plain key, and the wrap key cannot be exported", async () => {
  const st = memory();
  assert.equal(await sealKey(st, KEY), true);
  assert.notDeepEqual([...st.row!.sealed.slice(0, 32)], [...KEY], "what is stored is not the key");
  assert.equal(st.row!.wrap.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("raw", st.row!.wrap));
  assert.deepEqual([...(await unsealKey(st))!], [...KEY]);
});

test("a device with no store, a wiped store or a key of the wrong size seals and opens nothing, without throwing", async () => {
  assert.equal(await sealKey(null, KEY), false);
  assert.equal(await unsealKey(null), null);
  assert.equal(await unsealKey(memory()), null);
  assert.equal(await sealKey(memory(), new Uint8Array(5)), false);
  const st = memory();
  await sealKey(st, KEY);
  st.row!.sealed[3] = st.row!.sealed[3]! ^ 1;
  assert.equal(await unsealKey(st), null, "a damaged copy is no key");
});

test("sign-in keeps the key; a relaunch restores it with no password; sign-out removes it from memory and the device", async () => {
  const st = memory();
  useSealStore(st);
  try {
    const mine = Uint8Array.from(KEY);
    assert.equal(await keepKey(mine), true);
    mine.fill(0);   // the sign-in code wipes its own copy right after
    assert.equal(keyIsKept(), true);
    leaveMemory();
    assert.equal(keyIsKept(), false, "the app was closed");
    assert.equal(await restoreKey(), true, "the next launch opens it by itself");
    assert.equal(keyIsKept(), true);
    forgetKey();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(st.row, null, "sign-out takes the device copy too");
    assert.equal(await restoreKey(), false, "nothing to restore after sign-out: the person signs in again");
  } finally { forgetKey(); useSealStore(undefined); }
});

test("a node that restarted gets the restored key handed over with no prompt", async () => {
  const st = memory();
  useSealStore(st);
  try {
    await keepKey(Uint8Array.from(KEY));
    leaveMemory();
    let held = false;
    const f = (async (url: string) => {
      if (String(url).endsWith("/status")) return { status: 200, json: async () => ({ held }) };
      held = true; return { status: 204 };
    }) as unknown as typeof fetch;
    assert.equal(await rehandKey("http://127.0.0.1:7777", "tok", f), false, "memory is empty until it is restored");
    await restoreKey();
    assert.equal(await rehandKey("http://127.0.0.1:7777", "tok", f), true);
    assert.equal(held, true);
  } finally { forgetKey(); useSealStore(undefined); }
});
