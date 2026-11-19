// The Run node (r42-runtime slice 1): the state machine, its events, leases, and the failure paths: a worker that dies, a restart mid-run, a duplicate event, two writers at once, a stop of a whole tree.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";
import { EDGES, NODE_KINDS, NODE_STATUSES, LEASE_TTL_MS, legalEdge } from "../node.ts";
import type { NodeStatus } from "../node.ts";

const host = { id: "svc_host", kind: "service" as const };
const outside = { ...alice, depth: 0 }; // a person typing a URL: depth 0, the gateway
const start = async (h: Harness, over: Record<string, unknown> = {}) =>
  (await h.call("runs.node.start", { kind: "helper", name: "Supplier review", owner: alice.id, ...over }, engine))
    .node as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const move = (h: Harness, runId: string, to: string, why: string, over: Record<string, unknown> = {}) =>
  h.call("runs.node.move", { runId, to, why, ...hold(h, runId), ...over }, engine);
const statusOf = (h: Harness, id: string): string =>
  String((h.sqlite.prepare("SELECT status FROM runs_node WHERE run_id = ?").get(id) as { status: string }).status);
const force = (h: Harness, id: string, status: NodeStatus): void => {
  h.sqlite.prepare("UPDATE runs_node SET status = ? WHERE run_id = ?").run(status, id);
};

test("every pair of states: the edge table says which moves are legal, and every other move is refused with a reason", async () => {
  for (const from of NODE_STATUSES)
    for (const to of NODE_STATUSES) {
      const h = harness();
      const n = await start(h);
      force(h, n.id, from);
      if (from === to) {
        const r = await move(h, n.id, to, "paused");
        assert.equal(r.changed, false, `${from} to ${to} is a no-op`);
      } else if (legalEdge(from, to)) {
        const r = await move(h, n.id, to, "paused");
        assert.equal(r.changed, true, `${from} to ${to}`);
        assert.equal(statusOf(h, n.id), to);
      } else {
        const e = await move(h, n.id, to, "paused").catch((x) => x);
        assert.equal(codeOf(e), "validation.precondition_failed", `${from} to ${to}`);
        assert.ok(["run_finished", "illegal_move"].includes(String(reasonOf(e))), `${from} to ${to}`);
        assert.equal(statusOf(h, n.id), from, "an illegal move changes nothing");
      }
    }
});

test("the edge table has no way out of a finished node, and a woken node always passes the scheduler (waiting goes to queued)", () => {
  for (const s of ["succeeded", "failed", "stopped"] as const) assert.deepEqual(EDGES[s], []);
  assert.equal(legalEdge("waiting", "running"), false);
  assert.equal(legalEdge("waiting", "queued"), true);
  assert.equal(legalEdge("paused", "running"), false);
  assert.deepEqual([...NODE_KINDS].sort(), [...new Set(NODE_KINDS)].sort());
});

test("a node starts queued; a child shares its parent's root and sits one level down; the start is idempotent by key", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn", name: "Review the suppliers" });
  assert.equal(root.status, "queued");
  assert.equal(root.rootRun, root.id);
  assert.equal(root.depth, 0);
  const kid = await start(h, { parentRun: root.id, idemKey: "call_1" });
  assert.equal(kid.rootRun, root.id);
  assert.equal(kid.depth, 1);
  const grand = await start(h, { parentRun: kid.id, kind: "subagent" });
  assert.equal(grand.depth, 2);
  assert.equal(grand.rootRun, root.id);
  const again = await h.call(
    "runs.node.start",
    { kind: "helper", owner: alice.id, parentRun: root.id, idemKey: "call_1" },
    engine,
  );
  assert.equal(again.created, false);
  assert.equal(again.node.id, kid.id);
  const tree = await h.call("runs.tree.get", { runId: root.id }, alice);
  assert.equal(tree.nodes.length, 3);
});

test("a finished node takes no new children, and a child of nothing is refused", async () => {
  const h = harness();
  const root = await start(h);
  await move(h, root.id, "stopped", "stopped");
  const e = await h
    .call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: root.id }, engine)
    .catch((x) => x);
  assert.equal(reasonOf(e), "parent_finished");
  const none = await h
    .call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: `run_${"0".repeat(32)}` }, engine)
    .catch((x) => x);
  assert.equal(reasonOf(none), "no_parent");
});

test("every transition writes one state event, in order, with a cursor a reader keeps", async () => {
  const h = harness();
  const n = await start(h);
  await h.call("runs.node.claim", { runId: n.id, holder: "host:spc" }, host);
  await move(h, n.id, "waiting", "slept", { wake: { kind: "process", label: "the build finishes" } });
  await move(h, n.id, "queued", "woke");
  await h.call("runs.node.claim", { runId: n.id, holder: "host:spc" }, host);
  await move(h, n.id, "succeeded", "done", { summary: "Five prices updated" });
  const all = await h.call("runs.events.list", { runId: n.id }, alice);
  assert.deepEqual(
    all.events.map((e: any) => `${e.payload.from ?? "-"}>${e.payload.to}:${e.payload.why}`), // eslint-disable-line @typescript-eslint/no-explicit-any
    [
      "->queued:started",
      "queued>running:claimed",
      "running>waiting:slept",
      "waiting>queued:woke",
      "queued>running:claimed",
      "running>succeeded:done",
    ],
  );
  assert.deepEqual(
    all.events.map((e: any) => e.seq),
    [1, 2, 3, 4, 5, 6],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  const since = await h.call("runs.events.list", { runId: n.id, since: 4 }, alice);
  assert.deepEqual(
    since.events.map((e: any) => e.seq),
    [5, 6],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(since.lastSeq, 6);
  const got = (await h.call("runs.node.get", { runId: n.id }, alice)).node;
  assert.equal(got.summary, "Five prices updated");
  assert.equal(got.wake?.wokeCount, 1, "it slept once and woke once");
  assert.ok(got.endedAt);
});

test("a duplicate event with the same key is the first event, and a usage line counts once", async () => {
  const h = harness();
  const n = await start(h);
  const a = await h.call(
    "runs.node.event",
    {
      runId: n.id,
      type: "usage",
      key: "call_7",
      payload: { tokensIn: 1000, tokensOut: 200, cacheRead: 600, usdMicros: 4000 },
    },
    engine,
  );
  const b = await h.call(
    "runs.node.event",
    {
      runId: n.id,
      type: "usage",
      key: "call_7",
      payload: { tokensIn: 1000, tokensOut: 200, cacheRead: 600, usdMicros: 4000 },
    },
    engine,
  );
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.seq, a.seq);
  await h.call(
    "runs.node.event",
    { runId: n.id, type: "usage", key: "call_8", payload: { tokensIn: 500, tokensOut: 50, usdMicros: 1000 } },
    engine,
  );
  const got = (await h.call("runs.node.get", { runId: n.id }, alice)).node;
  assert.deepEqual(got.spent, { tokensIn: 1500, tokensOut: 250, cacheRead: 600, usdMicros: 5000, calls: 2 });
});

test("a late usage line for a finished node still counts, and the tree total adds up the subtree", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn" });
  const kid = await start(h, { parentRun: root.id });
  await move(h, kid.id, "stopped", "stopped");
  await h.call(
    "runs.node.event",
    { runId: kid.id, type: "usage", key: "late", payload: { tokensIn: 300, tokensOut: 30, usdMicros: 900 } },
    engine,
  );
  await h.call(
    "runs.node.event",
    { runId: root.id, type: "usage", key: "own", payload: { tokensIn: 100, tokensOut: 10, usdMicros: 100 } },
    engine,
  );
  const tree = await h.call("runs.tree.get", { runId: root.id }, alice);
  assert.equal(tree.spent.tokensIn, 400);
  assert.equal(tree.spent.usdMicros, 1000);
  assert.equal(tree.spent.calls, 2);
});

test("a late wake for a finished node is a no-op to the same state and a refusal to any other", async () => {
  const h = harness();
  const n = await start(h);
  await move(h, n.id, "failed", "failed", { error: { code: "tool_failed", message: "Numbers had no column" } });
  assert.equal((await move(h, n.id, "failed", "failed")).changed, false);
  const e = await move(h, n.id, "queued", "woke").catch((x) => x);
  assert.equal(reasonOf(e), "run_finished");
  assert.equal((await h.call("runs.node.get", { runId: n.id }, alice)).node.errorCode, "tool_failed");
});

test("worker dies: its lease runs out, the node goes back in the queue as attempt 2, and the dead worker's heartbeat is refused", async () => {
  const h = harness();
  const n = await start(h);
  const got = await h.call("runs.node.claim", { runId: n.id, holder: "host:a" }, host);
  assert.equal(got.node.status, "running");
  assert.equal((await h.call("runs.node.beat", { runId: n.id, holder: "host:a" }, host)).held, true);
  h.advance(LEASE_TTL_MS - 1);
  assert.deepEqual((await h.call("runs.node.reclaim", {}, host)).reclaimed, [], "still beating, not touched");
  h.advance(2);
  assert.deepEqual((await h.call("runs.node.reclaim", {}, host)).reclaimed, [n.id]);
  const back = (await h.call("runs.node.get", { runId: n.id }, alice)).node;
  assert.equal(back.status, "queued");
  assert.equal(back.attempt, 2);
  assert.equal(back.leaseHolder, undefined);
  assert.equal(
    (await h.call("runs.node.beat", { runId: n.id, holder: "host:a" }, host)).held,
    false,
    "the dead worker must stop",
  );
  const taken = await h.call("runs.node.claim", { runId: n.id, holder: "host:b" }, host);
  assert.equal(taken.node.status, "running");
  assert.equal(taken.node.attempt, 2);
  const events = (await h.call("runs.events.list", { runId: n.id }, alice)).events.map((e: any) => e.payload.why); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(events, ["started", "claimed", "worker_lost", "claimed"]);
});

test("server restart mid-run: nothing is held in memory, so a new process reads the same rows, reclaims what died and leaves a sleeping node asleep", async () => {
  const h = harness();
  const running = await start(h, { name: "running" });
  const asleep = await start(h, { name: "asleep" });
  const lone = await start(h, { name: "rides its parent", running: true });
  await h.call("runs.node.claim", { runId: running.id, holder: "host:old" }, host);
  await h.call("runs.node.claim", { runId: asleep.id, holder: "host:old" }, host);
  await move(h, asleep.id, "waiting", "slept", {
    wake: { kind: "time", dueAt: h.now() + 3_600_000, label: "9:00 tomorrow" },
  });
  // the server goes down for a minute and comes back: a fresh ctx over the same database, the old holder never beats again
  h.advance(60_000);
  const reclaimed = (await h.call("runs.node.reclaim", {}, host)).reclaimed;
  assert.deepEqual(reclaimed, [running.id]);
  assert.equal(statusOf(h, asleep.id), "waiting", "a sleeping node keeps its wait");
  assert.equal(
    statusOf(h, lone.id),
    "running",
    "a node with no lease of its own rides its parent's and is not touched here",
  );
  const woke = (await h.call("runs.node.get", { runId: asleep.id }, alice)).node;
  assert.equal(woke.wake.kind, "time");
});

test("two writers at once: a stale version is refused, and the one that lands on the same state is a no-op", async () => {
  const h = harness();
  const n = await start(h);
  const v = n.version;
  await h.call("runs.node.claim", { runId: n.id, holder: "host:a" }, host);
  const e = await move(h, n.id, "paused", "paused", { expectedVersion: v }).catch((x) => x);
  assert.equal(reasonOf(e), "stale_version");
  const e2 = await move(h, n.id, "paused", "paused", { expectedFrom: "queued" }).catch((x) => x);
  assert.equal(reasonOf(e2), "run_moved");
  const [one, two] = await Promise.all([move(h, n.id, "stopped", "stopped"), move(h, n.id, "stopped", "stopped")]);
  assert.deepEqual([one.changed, two.changed].sort(), [false, true]);
  const stops = (await h.call("runs.events.list", { runId: n.id }, alice)).events.filter(
    (x: any) => x.payload.to === "stopped",
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(stops.length, 1, "one state event for one move");
});

test("stop takes the whole subtree, parents first, and leaves a finished child as it was", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn" });
  const a = await start(h, { parentRun: root.id });
  const b = await start(h, { parentRun: root.id });
  const deep = await start(h, { parentRun: a.id, kind: "subagent" });
  await h.call("runs.node.claim", { runId: b.id, holder: "host:a" }, host);
  await move(h, b.id, "succeeded", "done", { summary: "Done early" });
  const out = await h.call("runs.node.control", { runId: root.id, action: "stop", reason: "Not needed" }, alice);
  assert.deepEqual(
    out.nodes.map((n: any) => n.id),
    [root.id, a.id, deep.id],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(statusOf(h, b.id), "succeeded");
  for (const id of [root.id, a.id, deep.id]) assert.equal(statusOf(h, id), "stopped");
  const why = (await h.call("runs.events.list", { runId: root.id }, alice)).events
    .filter((e: any) => e.payload.to === "stopped")
    .map((e: any) => `${e.runId === root.id ? "root" : "child"}:${e.payload.why}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(why, ["root:stopped", "child:parent_stopped", "child:parent_stopped"]);
  const again = await h.call("runs.node.control", { runId: root.id, action: "stop" }, alice);
  assert.equal(again.nodes.length, 1, "a second stop of the same node is a no-op");
});

test("a node cannot be paused yet (nothing behind it would hold still); resume works on a node that a rule paused", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn" });
  await h.call("runs.node.claim", { runId: root.id, holder: "host:a" }, host);
  const e = await h.call("runs.node.control", { runId: root.id, action: "pause" }, alice).catch((x) => x);
  assert.equal(reasonOf(e), "not_pausable");
  assert.equal(statusOf(h, root.id), "running", "a refused pause changes nothing");
  // a budget rule (later) pauses a node by the engine's own move; a person resumes it
  await move(h, root.id, "paused", "budget");
  assert.equal(
    (await h.call("runs.node.claim", { runId: root.id, holder: "host:b" }, host)).node,
    undefined,
    "a paused node is not claimed",
  );
  const r = await h.call("runs.node.control", { runId: root.id, action: "resume", subtree: false }, alice);
  assert.equal(r.nodes[0].status, "queued");
  const again = await h.call("runs.node.control", { runId: root.id, action: "resume" }, alice).catch((x) => x);
  assert.equal(reasonOf(again), "not_paused");
});

test("stop reaches the engine first: a helper's turn is stopped through engine.stop, and a node whose stop failed does not claim to be stopped", async () => {
  const h = harness();
  const calls: unknown[] = [];
  h.callee("engine.stop", (input) => {
    calls.push(input);
    return { stopped: 1 };
  });
  const root = await start(h, {
    kind: "turn",
    threadId: `thr_${"a".repeat(32)}`,
    whoKind: "agent",
    whoId: `agt_${"b".repeat(32)}`,
  });
  const kid = await start(h, {
    parentRun: root.id,
    threadId: `thr_${"c".repeat(32)}`,
    whoKind: "agent",
    whoId: `agt_${"d".repeat(32)}`,
  });
  await h.call("runs.node.control", { runId: root.id, action: "stop" }, { ...alice, depth: 0 });
  assert.deepEqual(calls, [
    { threadId: `thr_${"a".repeat(32)}`, agentId: `agt_${"b".repeat(32)}` },
    { threadId: `thr_${"c".repeat(32)}`, agentId: `agt_${"d".repeat(32)}` },
  ]);
  assert.deepEqual([statusOf(h, root.id), statusOf(h, kid.id)], ["stopped", "stopped"]);
  const h2 = harness();
  h2.callee("engine.stop", () => {
    throw new Error("down");
  });
  const n = await start(h2, {
    kind: "helper",
    threadId: `thr_${"a".repeat(32)}`,
    whoKind: "agent",
    whoId: `agt_${"b".repeat(32)}`,
  });
  const e = await h2.call("runs.node.control", { runId: n.id, action: "stop" }, { ...alice, depth: 0 }).catch((x) => x);
  assert.equal(reasonOf(e), "stop_failed");
  assert.equal(statusOf(h2, n.id), "queued", "still what it was");
});

test("who may do what: a person at the gateway cannot move or claim; the owner controls their own; another person cannot even see it; a manager can", async () => {
  const h = harness({ authorize: (who, action) => who.id === "usr_admin" && action.perm === "runs.manage" });
  const n = await start(h);
  for (const [cap, input] of [
    ["runs.node.move", { runId: n.id, to: "stopped", why: "stopped" }],
    ["runs.node.claim", { runId: n.id, holder: "x" }],
    ["runs.node.event", { runId: n.id, type: "step" }],
    ["runs.node.start", { kind: "helper", owner: alice.id }],
  ] as const)
    assert.equal(codeOf(await h.call(cap, input, outside).catch((x) => x)), "permission.no_grant", cap);
  assert.equal(
    codeOf(await h.call("runs.node.get", { runId: n.id }, { ...bob, depth: 0 }).catch((x) => x)),
    "permission.not_found",
  );
  assert.equal(
    codeOf(await h.call("runs.node.control", { runId: n.id, action: "stop" }, { ...bob, depth: 0 }).catch((x) => x)),
    "permission.not_found",
  );
  await h.call("runs.node.control", { runId: n.id, action: "stop" }, { ...alice, depth: 0 }).catch(() => undefined); // the owner may stop their own
  assert.equal(statusOf(h, n.id), "stopped");
  const m = await start(h);
  await h.call("runs.node.control", { runId: m.id, action: "stop" }, { id: "usr_admin", kind: "person", depth: 0 });
  assert.equal(statusOf(h, m.id), "stopped");
});

test("every kind the contract names can be started", async () => {
  const h = harness();
  for (const kind of NODE_KINDS) assert.equal((await start(h, { kind })).kind, kind);
});

test("a worker that lost its lease cannot close the node the next worker holds: a move names its lease and its attempt", async () => {
  const h = harness();
  const n = await start(h);
  await h.call("runs.node.claim", { runId: n.id, holder: "host:a" }, host);
  h.advance(LEASE_TTL_MS + 1);
  await h.call("runs.node.reclaim", {}, host);
  const b = (await h.call("runs.node.claim", { runId: n.id, holder: "host:b" }, host)).node;
  assert.equal(b.attempt, 2);
  const late = await move(h, n.id, "succeeded", "done", { holder: "host:a", attempt: 1 }).catch((x) => x);
  assert.equal(reasonOf(late), "not_holder");
  assert.equal(statusOf(h, n.id), "running", "the live node is untouched");
  const noName = await h.call("runs.node.move", { runId: n.id, to: "succeeded", why: "done" }, engine).catch((x) => x);
  assert.equal(reasonOf(noName), "not_holder", "a move that names no lease is refused while one is held");
  const stale = await move(h, n.id, "succeeded", "done", { holder: "host:b", attempt: 1 }).catch((x) => x);
  assert.equal(reasonOf(stale), "stale_attempt");
  assert.equal((await move(h, n.id, "succeeded", "done", { holder: "host:b", attempt: 2 })).changed, true);
});

test("pausing a tree leaves a sleeping node asleep with its wait, and it is paused when it wakes into a paused parent, never run", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn" });
  const sleeper = await start(h, { parentRun: root.id });
  await h.call("runs.node.claim", { runId: sleeper.id, holder: "host:a" }, host);
  await move(h, sleeper.id, "waiting", "slept", { wake: { kind: "event", label: "the build finishes" } });
  await h.call("runs.node.claim", { runId: root.id, holder: "host:a" }, host);
  // a rule pauses the root (the engine's own move); the sleeper is not part of it
  await move(h, root.id, "paused", "budget");
  assert.equal(statusOf(h, sleeper.id), "waiting");
  await move(h, sleeper.id, "queued", "woke");
  assert.equal(statusOf(h, sleeper.id), "paused", "woke into a paused parent");
  const got = (await h.call("runs.node.get", { runId: sleeper.id }, { ...alice, depth: 0 })).node;
  assert.equal(got.wake?.label, "the build finishes", "it still knows what it waited for");
  await h.call("runs.node.control", { runId: root.id, action: "resume" }, { ...alice, depth: 0 });
  assert.equal(statusOf(h, sleeper.id), "queued");
});

test("node_ended says only that a node is over, never what it found: its words stay with the people who may read the node", async () => {
  const h = harness();
  const n = await start(h);
  await h.call("runs.node.claim", { runId: n.id, holder: "host:a" }, host);
  await move(h, n.id, "succeeded", "done", { holder: "host:a", summary: "Pine's price is 3,820" });
  const ended = h.allEvents.filter((e) => e.name === "run.node_ended");
  assert.equal(ended.length, 1);
  assert.deepEqual(Object.keys(ended[0]!.payload).sort(), ["kind", "rootRun", "runId", "to"]);
  assert.equal(JSON.stringify(h.allEvents).includes("3,820"), false);
});
