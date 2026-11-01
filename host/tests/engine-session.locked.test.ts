// A locked Vault key is waited for, not failed on: after an app start the key arrives a moment later, and a person can unlock in place. The turn goes on by itself when the key is there; only a key that stays
// locked for the whole wait reports the Vault as locked (the Unlock card), and nothing else is ever retried.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngineSessionHost } from "../src/seams/engine-session.ts";

const who = { agentId: "agt_1", asker: "usr_1", where: "host" as const };
const ok = async () => ({ status: "ok" as const, output: { itemId: "vit_1" } }) as never;

function host(secret: () => Promise<string>, clock: { t: number }) {
  const slept: number[] = [];
  const h = createEngineSessionHost({
    invoke: ok, vault: { secret } as never, space: "spc_1", lockedWaitMs: 10_000, lockedPollMs: 2_000,
    sleep: async (ms) => { slept.push(ms); clock.t += ms; }, now: () => clock.t,
  });
  return { h, slept };
}

test("the key arrives while the turn waits: the lookup answers with the value, no failure", async () => {
  let calls = 0;
  const { h, slept } = host(async () => { if (++calls < 3) throw new Error("Your vault key is locked on this computer."); return "SECRETVALUE"; }, { t: 0 });
  const r = await h.source.lookup("#Claude_Code.setup_token", who);
  assert.deepEqual(r.kind === "value" ? [r.kind, r.itemId] : r.kind, ["value", "vit_1"]);
  assert.deepEqual(slept, [2000, 2000]);
});

test("a key that stays locked for the whole wait reports the Vault as locked, after waiting", async () => {
  const clock = { t: 0 };
  const { h, slept } = host(async () => { throw new Error("Your vault key is locked on this computer."); }, clock);
  await assert.rejects(h.source.lookup("#Claude_Code.setup_token", who), (e: { code?: string }) => e.code === "engine.vault_locked");
  assert.ok(slept.length >= 4, "it waited, not failed at once");
});

test("any other failure is not waited on", async () => {
  const { h, slept } = host(async () => { throw new Error("disk on fire"); }, { t: 0 });
  await assert.rejects(h.source.lookup("#Claude_Code.setup_token", who), (e: { code?: string }) => e.code === "engine.vault_unreadable");
  assert.deepEqual(slept, []);
});

test("a field that is not in the item, or an item that is gone, is said in plain words and logged by field name (never a value); it is not a locked Vault", async () => {
  const logs: Array<[string, Record<string, unknown> | undefined]> = [];
  const h = createEngineSessionHost({
    invoke: (async () => { throw Object.assign(new Error("This item has no field setup_token."), { code: "validation.bad_input" }); }) as never,
    vault: { secret: async () => "x" } as never, space: "spc_1", log: (m, a) => logs.push([m, a]),
  });
  const r = await h.source.lookup("#Claude_Code.setup_token", who);
  assert.deepEqual(r, { kind: "unknown" }, "the caller sees the same refusal as before");
  assert.match(String(logs[0]![1]!["why"]), /no setup_token field/);
  assert.deepEqual([logs[0]![1]!["field"], logs[0]![1]!["handle"]], ["setup_token", "Claude_Code"]);
  assert.equal(JSON.stringify(logs).includes("x\""), false);
});
