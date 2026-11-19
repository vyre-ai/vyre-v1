// Limits on a tree of agent work (r42-runtime slice 6): reached, the work under the limit is paused at its next safe point and the owner is told, once; raised, it goes on; never a silent stop, never a call cut in half.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";

const THREAD = (c: string): string => `thr_${c.repeat(32)}`;
const AGENT = (c: string): string => `agt_${c.repeat(32)}`;
const owner = { ...alice, depth: 0 };
interface Rig {
  h: Harness;
  paused: Array<{ threadId: string; agentId: string }>;
  resumed: Array<{ threadId: string; agentId: string }>;
  tasks: Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function rig(opts: { pauseFails?: boolean } = {}): Rig {
  const h = harness();
  const r: Rig = { h, paused: [], resumed: [], tasks: [] };
  h.callee("engine.pause", (i: { threadId: string; agentId: string }) => {
    if (opts.pauseFails) throw new Error("down");
    r.paused.push({ threadId: i.threadId, agentId: i.agentId });
    return { paused: 1 };
  });
  h.callee("engine.resume_paused", (i: { threadId: string; agentId: string }) => {
    r.resumed.push({ threadId: i.threadId, agentId: i.agentId });
    return { resumed: 1, lost: 0 };
  });
  h.callee("tasks.create", (i: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    r.tasks.push(i);
    return { task: { id: `tsk_${r.tasks.length}` } };
  });
  return r;
}
async function job(r: Rig, budget?: Record<string, number>) {
  const h = r.h;
  h.advance(1);
  const root = (await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: THREAD("a"), whoKind: "agent", whoId: AGENT("a"), running: true, name: "Supplier review", ...(budget ? { budget } : {}) }, engine)).node;
  const mk = async (c: string) => {
    h.advance(1);
    return (await h.call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: root.id, threadId: THREAD(c), whoKind: "agent", whoId: AGENT(c), running: true }, engine)).node;
  };
  return { root, a: await mk("b"), b: await mk("c") };
}
const use = (r: Rig, runId: string, key: string, over: Record<string, number>) =>
  r.h.call("runs.node.event", { runId, type: "usage", key, payload: { tokensIn: 0, tokensOut: 0, ...over } }, engine);
const status = (h: Harness, id: string): string => String((h.sqlite.prepare("SELECT status FROM runs_node WHERE run_id = ?").get(id) as { status: string }).status);

test("under the limit nothing happens; the call that reaches it is counted whole, and every live node under the limit is paused, with one Needs you for the owner", async () => {
  const r = rig();
  const { root, a, b } = await job(r, { usdMicros: 2_000_000 });
  await use(r, a.id, "u1", { usdMicros: 900_000, tokensIn: 1000 });
  await use(r, b.id, "u2", { usdMicros: 900_000 });
  assert.deepEqual(r.paused, []);
  await use(r, a.id, "u3", { usdMicros: 600_000 }); // 2.4 of 2.0: the call in flight finished and is counted as it was
  assert.deepEqual(r.paused.map((p) => p.agentId).sort(), [AGENT("a"), AGENT("b"), AGENT("c")].sort(), "the lead and both helpers");
  const tree = await r.h.call("runs.tree.get", { runId: root.id }, owner);
  assert.equal(tree.spent.usdMicros, 2_400_000, "the number shown is what was really used");
  assert.equal(r.tasks.length, 1);
  assert.match(r.tasks[0]!.title, /Supplier review reached its limit/);
  assert.match(r.tasks[0]!.summary, /\$2\.40 of the \$2\.00/);
  assert.equal(r.tasks[0]!.assigned.id, alice.id);
  const ev = (await r.h.call("runs.events.list", { runId: root.id }, owner)).events.filter((e: any) => e.type === "budget"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(ev.length, 1);
});

test("once is once: more use after the limit, or the same event again, pauses nothing twice and asks the owner nothing twice", async () => {
  const r = rig();
  const { a } = await job(r, { tokens: 1000 });
  await use(r, a.id, "u1", { tokensIn: 800, tokensOut: 300 });
  const pauses = r.paused.length;
  await use(r, a.id, "u1", { tokensIn: 800, tokensOut: 300 }); // the same event again
  await use(r, a.id, "u2", { tokensOut: 50 }); // a call that was already in flight
  assert.equal(r.paused.length, pauses);
  assert.equal(r.tasks.length, 1);
});

test("a limit on a helper holds for it and what it started, not for its siblings or its parent", async () => {
  const r = rig();
  const { root, a, b } = await job(r);
  await r.h.call("runs.budget.set", { runId: a.id, usdMicros: 500_000 }, owner);
  await use(r, b.id, "b1", { usdMicros: 5_000_000 });
  assert.deepEqual(r.paused, [], "the sibling spent a lot; nobody limited it or the job");
  await use(r, a.id, "a1", { usdMicros: 600_000 });
  assert.deepEqual(r.paused.map((p) => p.agentId), [AGENT("b")], "only the helper under the limit");
  void root;
});

test("raising the limit past what was used lets the paused work go on; raising it a little does not; clearing it does; each paused node has done its part", async () => {
  const r = rig();
  const { root, a } = await job(r, { usdMicros: 1_000_000 });
  await use(r, a.id, "u1", { usdMicros: 1_200_000 });
  // what the engine does at the safe point: the turn's node says paused
  for (const id of [root.id, a.id]) await r.h.call("runs.node.move", { runId: id, to: "paused", why: "budget", ...hold(r.h, id) }, engine);
  const little = await r.h.call("runs.budget.set", { runId: root.id, usdMicros: 1_100_000 }, owner);
  assert.equal(little.resumed, 0);
  assert.deepEqual(r.resumed, []);
  assert.equal(status(r.h, a.id), "paused");
  const enough = await r.h.call("runs.budget.set", { runId: root.id, usdMicros: 5_000_000 }, owner);
  assert.equal(enough.resumed, 2);
  assert.deepEqual(r.resumed.map((x) => x.agentId).sort(), [AGENT("a"), AGENT("b")].sort());
  assert.equal(status(r.h, a.id), "stopped", "its turn goes on as a new turn of its own");
  // the same limit reached again acts again: a new limit is a new decision
  const again = await job(r, { usdMicros: 1_000_000 });
  await use(r, again.a.id, "z1", { usdMicros: 2_000_000 });
  await r.h.call("runs.node.move", { runId: again.root.id, to: "paused", why: "budget", ...hold(r.h, again.root.id) }, engine);
  const cleared = await r.h.call("runs.budget.set", { runId: again.root.id, clear: true }, owner);
  assert.ok(cleared.resumed >= 1);
});

test("resume from the tile is refused while a limit above is still reached, and works once raised", async () => {
  const r = rig();
  const { root, a } = await job(r, { tokens: 100 });
  await use(r, a.id, "u1", { tokensIn: 150 });
  await r.h.call("runs.node.move", { runId: a.id, to: "paused", why: "budget", ...hold(r.h, a.id) }, engine);
  assert.equal(reasonOf(await r.h.call("runs.node.control", { runId: a.id, action: "resume" }, owner).catch((e) => e)), "over_budget");
  assert.equal(status(r.h, a.id), "paused");
  await r.h.call("runs.budget.set", { runId: root.id, tokens: 10_000 }, owner);
  assert.equal(status(r.h, a.id), "stopped", "the raise already took it on");
});

test("when the engine cannot pause, the node says so on its record and the owner is still told; nothing is thrown at the model call", async () => {
  const r = rig({ pauseFails: true });
  const { root, a } = await job(r, { tokens: 10 });
  await use(r, a.id, "u1", { tokensIn: 50 });
  assert.equal(r.tasks.length, 1);
  const ev = (await r.h.call("runs.events.list", { runId: root.id }, owner)).events.filter((e: any) => e.type === "budget"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(ev.some((e: any) => e.payload.problem === "pause_failed")); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("only the owner or a manager sets a limit; a person who only watches, or a stranger, cannot; a bad value is refused", async () => {
  const r = rig();
  const { root } = await job(r);
  assert.equal(codeOf(await r.h.call("runs.budget.set", { runId: root.id, usdMicros: 1_000 }, { ...bob, depth: 0 }).catch((e) => e)), "permission.not_found");
  assert.ok((await r.h.call("runs.budget.set", { runId: root.id, usdMicros: 1_000_000 }, owner)).node.budget);
  await assert.rejects(() => r.h.call("runs.budget.set", { runId: root.id, usdMicros: -5 }, owner));
});
