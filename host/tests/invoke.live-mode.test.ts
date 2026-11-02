// Hole 13: the Gate goes by the chat's mode at the moment of the act, not the mode the turn started in, and an Always allow rule lets a call past Ask first only when it is read then.
import test from "node:test";
import assert from "node:assert/strict";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, GateHook, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = { name: "files.write", v: 1, effects: "write", level: "use", permission: null, emits: [], risk: "low", audit: "none", idempotency: "none", resource: { type: "space" } } as unknown as CapabilityDef;

function rig(o: { mode: "auto" | "ask" | "plan"; allowed?: boolean }) {
  const ran: string[] = [];
  const parked: string[] = [];
  const gate: GateHook = {
    applies: () => null, verify: () => false,
    park: async (a) => { parked.push(a.act); return { taskId: "tsk_1" }; },
    mode: () => o.mode, allowed: async () => o.allowed === true,
  };
  const deps = {
    caps: indexCapabilities([cap]), validateInput: () => [], authorize: () => ({ effect: "allow", reason: "ok", steps: [], scope: undefined, obligations: [], decisionId: "dec_1" }),
    handler: () => async () => { ran.push("ran"); return { ok: true }; }, commit: async (b: { events: unknown[] }) => b.events, gate,
    log: { debug() {}, info() {}, warn() {}, error(m: string, a: unknown) { console.error(m, a); } },
  } as unknown as InvokeDeps;
  return { invoke: createInvoke(deps), ran, parked };
}
const seed = (over: Partial<CtxSeed> = {}): CtxSeed => ({ space: "spc_1", principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_a", thread: "thr_1", chatMode: "auto", askable: true, ...over });

test("a chat switched to Ask first during a turn parks the next change", async () => {
  const r = rig({ mode: "ask" });
  assert.equal((await r.invoke("files.write", {}, seed())).status, "held");
  assert.deepEqual([r.ran, r.parked], [[], ["approve"]]);
});

test("a chat switched to Plan during a turn refuses the next change", async () => {
  const r = rig({ mode: "plan" });
  await assert.rejects(r.invoke("files.write", {}, seed()), (e: { error?: { code?: string } }) => e.error?.code === "permission.plan_mode");
  assert.deepEqual(r.ran, []);
});

test("Auto runs it, and a live Always allow lets it past Ask first", async () => {
  const auto = rig({ mode: "auto" });
  assert.equal((await auto.invoke("files.write", {}, seed())).status, "ok");
  const allowed = rig({ mode: "ask", allowed: true });
  assert.equal((await allowed.invoke("files.write", {}, seed())).status, "ok");
  assert.deepEqual(allowed.parked, []);
});

test("a hard local rule asks whatever is allowed", async () => {
  const r = rig({ mode: "ask", allowed: true });
  assert.equal((await r.invoke("files.write", {}, seed({ mustAsk: true, askFirst: true }))).status, "held");
});
