// The engine's host half (P-L2_23): capabilities run for a person through the real pipeline, the agent speaks into chat as itself, and the options the daemon hands to the module (data directory,
// sandbox plan, CLI swap, invoke and Space id for API-key tools) arrive unchanged. The module itself is not booted here: engine cannot be flipped live until its remaining handlers exist
// (engine.placement.decide, engine.pool.status, engine.warm), so the booted agent flow is golden flow 7 (P-L11_08); modules/engine/tests/cli.heavy.test.ts is the lower-level proof.
import test from "node:test";
import assert from "node:assert/strict";
import type { CtxSeed, Invoke } from "../src/invoke.ts";
import { createEngineHost } from "../src/seams/engine.ts";

function world(): { calls: Array<{ cap: string; input: unknown; seed: CtxSeed }>; invoke: Invoke } {
  const calls: Array<{ cap: string; input: unknown; seed: CtxSeed }> = [];
  const invoke: Invoke = async (cap, input, seed) => { calls.push({ cap, input, seed }); return { status: "ok", output: { cap }, traceId: "a".repeat(32) } as Awaited<ReturnType<Invoke>>; };
  return { calls, invoke };
}

test("call runs a capability as the person it is for, or as the host's service principal with preAuth when no person is named", async () => {
  const w = world();
  const h = createEngineHost({ space: "spc_1", invoke: w.invoke });
  assert.equal(h.holder, "host:spc_1");
  await h.call("agents.get", { agentId: "agt_1" }, "usr_dana");
  await h.call("engine.sweep", {});
  assert.deepEqual(w.calls[0]!.seed.principal, { kind: "person", id: "usr_dana" });
  assert.notEqual(w.calls[0]!.seed.preAuth, true, "a person's call is authorized, not skipped");
  assert.deepEqual(w.calls[1]!.seed.principal, { kind: "service", id: "svc_host" });
  assert.equal(w.calls[1]!.seed.preAuth, true);
});

test("postAs posts into chat as the agent, and a call held at the Gate is an error, not a silent success", async () => {
  const w = world();
  const h = createEngineHost({ space: "spc_1", invoke: w.invoke });
  await h.postAs("agt_1", { threadId: "thr_1", body: "hi", blocks: [], mentions: [], clientId: "msg_1" });
  assert.equal(w.calls[0]!.cap, "chat.post");
  assert.deepEqual(w.calls[0]!.seed.principal, { kind: "agent", id: "agt_1" });
  const held = createEngineHost({ space: "spc_1", invoke: (async () => ({ status: "held", traceId: "b".repeat(32) })) as unknown as Invoke });
  await assert.rejects(held.call("agents.get", {}, "usr_dana"), /held for approval/);
});

test("the daemon's options reach the module unchanged: data directory, sandbox plan, CLI swap, invoke and Space id; and without the Vault there are no session ports", () => {
  const w = world();
  const plan = { sandbox: { kind: "server" }, dataDir: "/data", egressHosts: [] };
  const cli = { command: { claude: ["node", "fake.mjs"] }, programRead: ["/fx"] };
  const h = createEngineHost({ space: "spc_1", invoke: w.invoke, dataDir: "/data", sandbox: plan, cli });
  const seam = h as unknown as Record<string, unknown>;
  assert.equal(seam["dataDir"], "/data");
  assert.equal(seam["sandbox"], plan);
  assert.equal(seam["cli"], cli);
  assert.equal(seam["invoke"], w.invoke);
  assert.equal(seam["space"], "spc_1");
  assert.equal(h.session, undefined, "no Vault, no real session opener");
});
