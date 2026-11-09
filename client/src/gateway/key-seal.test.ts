// The person key stays on the device for the signed-in session (owner ruling 6 Nov: signed in means unlocked). Sealed with a non-extractable WebCrypto key, restored after a relaunch with no password,
// removed at sign-out, and handed again to a node that restarted.
import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_ROW, sealKey, sealRow, unsealKey } from "./key-seal.ts";
import type { SealRecord, SealStore } from "./key-seal.ts";
import { forgetKey, keepKey, keyIsKept, leaveMemory, rehandKey, restoreKey, useSealStore } from "./key-keeper.ts";

const memory = (): SealStore & { rows: Map<string, SealRecord> } => {
  const rows = new Map<string, SealRecord>();
  return { rows, get: async (k) => rows.get(k) ?? null, put: async (k, r) => { rows.set(k, r); }, remove: async (k) => { rows.delete(k); }, clear: async () => { rows.clear(); } };
};
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

test("a sealed key opens again, never reads back as the plain key, and the wrap key cannot be exported", async () => {
  const st = memory();
  assert.equal(await sealKey(st, "r", KEY), true);
  const row = st.rows.get("r")!;
  assert.notDeepEqual([...row.sealed.slice(0, 32)], [...KEY], "what is stored is not the key");
  assert.equal(row.wrap.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("raw", row.wrap));
  assert.deepEqual([...(await unsealKey(st, "r"))!], [...KEY]);
});

test("a device with no store, a wiped store or a key of the wrong size seals and opens nothing, without throwing", async () => {
  assert.equal(await sealKey(null, "r", KEY), false);
  assert.equal(await unsealKey(null, "r"), null);
  assert.equal(await unsealKey(memory(), "r"), null);
  assert.equal(await sealKey(memory(), "r", new Uint8Array(5)), false);
  const st = memory();
  await sealKey(st, "r", KEY);
  st.rows.get("r")!.sealed[3] = st.rows.get("r")!.sealed[3]! ^ 1;
  assert.equal(await unsealKey(st, "r"), null, "a damaged copy is no key");
});

test("sign-in keeps the key; a relaunch restores it with no password; sign-out removes it from memory and the device", async () => {
  const st = memory();
  useSealStore(st);
  try {
    const mine = Uint8Array.from(KEY);
    assert.equal(await keepKey(mine, "tok"), true);
    mine.fill(0);   // the sign-in code wipes its own copy right after
    assert.equal(keyIsKept("tok"), true);
    leaveMemory();
    assert.equal(keyIsKept(), false, "the app was closed");
    assert.equal(await restoreKey("tok"), true, "the next launch opens it by itself");
    assert.equal(keyIsKept("tok"), true);
    forgetKey("tok");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(st.rows.size, 0, "sign-out takes the device copy too");
    assert.equal(await restoreKey("tok"), false, "nothing to restore after sign-out: the person signs in again");
  } finally { forgetKey(); useSealStore(undefined); }
});

test("a node that restarted gets the restored key handed over with no prompt", async () => {
  const st = memory();
  useSealStore(st);
  try {
    await keepKey(Uint8Array.from(KEY), "tok");
    leaveMemory();
    let held = false;
    const f = (async (url: string) => {
      if (String(url).endsWith("/status")) return { status: 200, json: async () => ({ held }) };
      held = true; return { status: 204 };
    }) as unknown as typeof fetch;
    assert.equal(await rehandKey("http://127.0.0.1:7777", "tok", f), false, "memory is empty until it is restored");
    await restoreKey("tok");
    assert.equal(await rehandKey("http://127.0.0.1:7777", "tok", f), true);
    assert.equal(held, true);
  } finally { forgetKey(); useSealStore(undefined); }
});

test("a device signed in to two Spaces keeps each account's key: signing in to one never replaces the other, a relaunch brings both back, and signing out of one leaves the other", async () => {
  const st = memory();
  useSealStore(st);
  const A = Uint8Array.from({ length: 32 }, () => 7), B = Uint8Array.from({ length: 32 }, () => 9);
  try {
    await keepKey(A, "tok-personal");
    await keepKey(B, "tok-team");
    assert.equal(st.rows.size, 2, "one sealed row per session");
    for (const row of st.rows.keys()) assert.doesNotMatch(row, /tok-/, "the store names a row by a hash, never the token");
    leaveMemory();   // the update: the app quits and the new version starts
    assert.equal(await restoreKey("tok-personal"), true);
    assert.equal(await restoreKey("tok-team"), true);
    const handed: Array<[string, string]> = [];
    const f = (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/status")) return { status: 200, json: async () => ({ held: false }) };
      handed.push([String(url), JSON.parse(init?.body ?? "{}").key]); return { status: 204 };
    }) as unknown as typeof fetch;
    assert.equal(await rehandKey("http://127.0.0.1:50283", "tok-personal", f), true);
    assert.equal(await rehandKey("https://team.example.com", "tok-team", f), true);
    assert.equal(handed[0]![1], Buffer.from(A).toString("base64"), "the Personal Space gets its own key");
    assert.equal(handed[1]![1], Buffer.from(B).toString("base64"), "the team Space gets its own key, never the other account's");
    forgetKey("tok-team");
    await new Promise((r) => setTimeout(r, 10));
    leaveMemory();
    assert.equal(await restoreKey("tok-team"), false, "the Space signed out of has no key left");
    assert.equal(await restoreKey("tok-personal"), true, "the other stays signed in with its key");
  } finally { forgetKey(); useSealStore(undefined); }
});

test("the single row an rc.23 device kept is never handed to anyone and goes once a session seals its own", async () => {
  const st = memory();
  await sealKey(st, LEGACY_ROW, KEY);
  useSealStore(st);
  try {
    assert.equal(await restoreKey("tok"), false, "the old shared row may be another account's key: it is not used");
    await keepKey(Uint8Array.from(KEY), "tok");
    assert.equal(st.rows.has(LEGACY_ROW), false);
    assert.equal(st.rows.has((await sealRow("tok"))!), true);
  } finally { forgetKey(); useSealStore(undefined); }
});
