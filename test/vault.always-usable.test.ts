// A signed-in person's Vault is always usable (owner ruling 6 Nov), the client half: a fresh sign-in hands the key over and keeps it sealed on the device, and a relaunch with a restarted node gets it back with no password.
// The desktop path is a daemon on this computer (loopback door), the web path is a Space server (https door). The host half is host/tests/vault.always-usable.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { createKeyring } from "../host/src/seams/keyring.ts";
import { createEngineSessionHost } from "../host/src/seams/engine-session.ts";
import { forgetKey, keepKey, leaveMemory, rehandKey, restoreKey, useSealStore } from "../client/src/gateway/key-keeper.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import type { SealRecord, SealStore } from "../client/src/gateway/key-seal.ts";

const KEY = Uint8Array.from({ length: 32 }, (_, i) => 100 + i);
const who = { agentId: "agt_1", asker: "usr_1", where: "host" as const, account: true };
const memory = (): SealStore => { let row: SealRecord | null = null; return { get: async () => row, put: async (r) => { row = r; }, remove: async () => { row = null; } }; };

/** A daemon: the keyring behind the key door, and a Vault that can read the person's credential only while the keyring holds their key. */
function daemon() {
  const ring = createKeyring({ allowed: () => true, live: () => true });
  const f = (async (url: string, init?: { body?: string }) => {
    const op = String(url).split("/").pop();
    if (op === "status") return { status: 200, json: async () => ({ held: ring.holds("usr_1") }) };
    if (op === "unlock") { ring.hold("usr_1", Buffer.from(JSON.parse(init!.body!).key, "base64"), "ses_1"); return { status: 204 }; }
    return { status: 404 };
  }) as unknown as typeof fetch;
  const slept: number[] = [];
  const host = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { const k = ring.get("usr_1"); if (!k) throw new Error("Your vault key is locked on this computer."); k.fill(0); return "CREDENTIAL"; } } as never,
    space: "spc_1", lockedWaitMs: 4_000, lockedPollMs: 2_000, sleep: async (ms) => { slept.push(ms); }, now: () => slept.reduce((a, b) => a + b, 0),
  });
  return { ring, f, host, slept };
}

for (const [door, address] of [["desktop (this computer)", "http://127.0.0.1:7777"], ["web (Space server over https)", "https://team.example.com"]] as const) {
  test(`${door}: a fresh sign-in runs a turn that needs a Vault credential at once, with no wait`, async () => {
    const d = daemon();
    useSealStore(memory());
    try {
      // sign-in opened the key with the password and hands it over, keeping it on the device
      const mine = Uint8Array.from(KEY);
      assert.equal(await holdKeyOnOwnNode(address, "tok", mine, d.f as never), true);
      await keepKey(mine); mine.fill(0);
      const r = await d.host.source.lookup("#Dana_Claude.credentials", who);
      assert.equal(r.kind, "value");
      assert.deepEqual(d.slept, [], "the first read answered; nothing waited for an unlock");
    } finally { forgetKey(); useSealStore(undefined); }
  });

  test(`${door}: after a relaunch and a restarted node the key comes back by itself and the turn runs`, async () => {
    const first = daemon();
    useSealStore(memory());
    try {
      await holdKeyOnOwnNode(address, "tok", Uint8Array.from(KEY), first.f as never);
      await keepKey(Uint8Array.from(KEY));
      // the app closes, the node restarts empty, the app opens again: no password anywhere
      leaveMemory();
      const second = daemon();
      assert.equal(await restoreKey(), true);
      assert.equal(await rehandKey(address, "tok", second.f), true);
      const r = await second.host.source.lookup("#Dana_Claude.credentials", who);
      assert.equal(r.kind, "value");
      assert.deepEqual(second.slept, []);
    } finally { forgetKey(); useSealStore(undefined); }
  });
}

