// The composer's warning before sending: from engine.account.resolve in dry mode, with the Space AI key offered to an owner or admin; an error never warns.
import test from "node:test";
import assert from "node:assert/strict";
import { aiReady } from "./ai-ready.ts";

const asked: Array<{ cap: string; input: unknown }> = [];
const call = (resolve: unknown, mayManage = false) => async (cap: string, input: unknown): Promise<unknown> => {
  asked.push({ cap, input });
  if (cap === "engine.account.resolve") { if (resolve instanceof Error) throw resolve; return resolve; }
  if (cap === "providers.space_key.get") return { set: false, models: [], mayManage };
  throw new Error(cap);
};

test("no account that can pay: not ready; an admin is offered the Space AI key; a member is not", async () => {
  assert.deepEqual(await aiReady(call({ accountRef: null, allowed: false, why: "no_account" }), "thr_1", "agt_1"), { ready: false, admin: false });
  assert.deepEqual(await aiReady(call({ accountRef: null, allowed: false, why: "no_account" }, true), "thr_1", "agt_1"), { ready: false, admin: true });
  assert.deepEqual(asked[0], { cap: "engine.account.resolve", input: { threadId: "thr_1", agentId: "agt_1", dry: true } }, "the dry check: the caller is the asker");
});

test("an account can pay, or the check cannot answer: no line", async () => {
  assert.deepEqual(await aiReady(call({ accountRef: "#Mine", allowed: true }), "thr_1", "agt_1"), { ready: true, admin: false });
  assert.deepEqual(await aiReady(call(new Error("offline")), "thr_1", "agt_1"), { ready: true, admin: false });
});
