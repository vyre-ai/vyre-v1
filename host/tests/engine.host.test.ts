// The engine's host half (P-L2_23): capabilities run for a person through the real pipeline, the agent speaks into chat as itself, and the options the daemon hands to the module (data directory,
// sandbox plan, CLI swap, invoke and Space id for API-key tools) arrive unchanged. The module itself is not booted here: engine cannot be flipped live until its remaining handlers exist
// (engine.placement.decide, engine.pool.status, engine.warm), so the booted agent flow is golden flow 7 (P-L11_08); modules/engine/tests/cli.heavy.test.ts is the lower-level proof.
import test from "node:test";
import assert from "node:assert/strict";
import type { CtxSeed, Invoke } from "../src/invoke.ts";
import { createEngineHost } from "../src/seams/engine.ts";

function world(): { calls: Array<{ cap: string; input: unknown; seed: CtxSeed }>; invoke: Invoke } {
  const calls: Array<{ cap: string; input: unknown; seed: CtxSeed }> = [];
  const invoke: Invoke = async (cap, input, seed) => {
    calls.push({ cap, input, seed });
    return { status: "ok", output: { cap }, traceId: "a".repeat(32) } as Awaited<ReturnType<Invoke>>;
  };
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
  assert.equal(w.calls[0]!.seed.sharedKey, undefined);
  await h.postAs("agt_1", {
    actingFor: "usr_1",
    sharedKey: true,
    threadId: "thr_1",
    body: "hi",
    blocks: [],
    mentions: [],
    clientId: "msg_2",
  });
  assert.equal(
    w.calls[1]!.seed.sharedKey,
    true,
    "the engine says a key of the Space paid, on the call and never in its input",
  );
  assert.equal("sharedKey" in (w.calls[1]!.input as object), false);
  const held = createEngineHost({
    space: "spc_1",
    invoke: (async () => ({ status: "held", traceId: "b".repeat(32) })) as unknown as Invoke,
  });
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

test("what the model thought goes to the person whose turn it is and nobody else; everything else goes to whoever may read the thread", async () => {
  const w = world();
  const frames: Array<{ kind: unknown; allow: (p: string) => boolean | Promise<boolean> }> = [];
  const h = createEngineHost({
    space: "spc_1",
    invoke: w.invoke,
    publishTurn: () => (frame, allow) => {
      frames.push({ kind: frame.delta["kind"], allow });
    },
  });
  h.stream!({
    kind: "thinking",
    threadId: "thr_1",
    turnId: "trn_1",
    agentId: "agt_1",
    text: "She mentioned the surgery privately",
    asker: "usr_dana",
  });
  h.stream!({ kind: "delta", threadId: "thr_1", turnId: "trn_1", agentId: "agt_1", text: "Done" });
  assert.equal(await frames[0]!.allow("usr_dana"), true);
  assert.equal(await frames[0]!.allow("usr_maya"), false, "a member of the same chat does not get it");
  assert.equal(await frames[1]!.allow("usr_maya"), true, "the words themselves are for the chat");
  assert.equal(
    w.calls.filter((c) => c.cap === "threads.get").length,
    1,
    "thinking asked nobody: only the words read the thread",
  );
});

test("the live text of a turn that read something goes to its asker only (gap 6); the checked answer is posted for all", async () => {
  const w = world();
  const frames: Array<{ allow: (p: string) => boolean | Promise<boolean> }> = [];
  const h = createEngineHost({
    space: "spc_1",
    invoke: w.invoke,
    publishTurn: () => (_frame, allow) => {
      frames.push({ allow });
    },
  });
  h.stream!({
    kind: "delta",
    threadId: "thr_1",
    turnId: "trn_1",
    agentId: "agt_1",
    text: "The deal is at 310k",
    asker: "usr_dana",
    privately: true,
  });
  assert.equal(await frames[0]!.allow("usr_dana"), true);
  assert.equal(await frames[0]!.allow("usr_maya"), false, "a member of the same chat does not get it live");
  const mayAll = (people: readonly string[]) => people.every((p) => p !== "usr_gus");
  const seam = createEngineHost({ space: "spc_1", invoke: w.invoke, mayAll });
  assert.equal(
    seam.mayAll?.(["usr_maya"], { perm: null, level: "view" }, { type: "record", id: "rec_1" }),
    true,
    "the daemon's per-person check reaches the engine",
  );
  assert.equal(
    seam.mayAll?.(["usr_maya", "usr_gus"], { perm: null, level: "view" }, { type: "record", id: "rec_1" }),
    false,
  );
});

test("a person's typing goes only to other people who may read that chat, never to the typist, never to an agent, and at most once every 2 s; a person who cannot read the chat tells nobody", async () => {
  const readers = new Set(["usr_mia", "usr_sam"]);
  const calls: string[] = [];
  const invoke: Invoke = async (cap, input, seed) => {
    calls.push(`${cap}:${seed.principal.id}`);
    if (cap === "threads.get" && !readers.has(seed.principal.id)) throw new Error("permission.denied");
    return { status: "ok", output: {}, traceId: "a".repeat(32) } as Awaited<ReturnType<Invoke>>;
  };
  const sent: Array<{ frame: unknown; to: string[] }> = [];
  let t = 1_000_000;
  const h = createEngineHost({
    space: "spc_1",
    invoke,
    now: () => t,
    publishTyping: () => async (frame, allow) => {
      const to: string[] = [];
      for (const p of ["usr_mia", "usr_sam", "usr_guest", "agt_helper"]) if (await allow(p)) to.push(p);
      sent.push({ frame, to });
    },
  });
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
  h.typing!("usr_mia", "thr_1");
  await settle();
  assert.deepEqual(sent[0]?.to, ["usr_sam"], "Sam only: not Mia herself, not the guest who cannot read it, not an agent");
  assert.deepEqual(sent[0]?.frame, { t: "typing", threadId: "thr_1", person: "usr_mia" });
  h.typing!("usr_mia", "thr_1");
  await settle();
  assert.equal(sent.length, 1, "a second frame inside 2 s is dropped");
  t += 2_100;
  h.typing!("usr_mia", "thr_1");
  await settle();
  assert.equal(sent.length, 2);
  h.typing!("usr_guest", "thr_1");
  h.typing!("agt_helper", "thr_1");
  await settle();
  assert.equal(sent.length, 2, "a person who cannot read the chat, and an agent, tell nobody anything");
});
