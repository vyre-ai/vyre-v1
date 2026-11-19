// Flow Runs in the tree (r42-runtime slice 2): a routine fire, an agent's wait and a terminal Run are mirrored as nodes with the state and the wake of the Run; they sleep and wake and end through the Run engine,
// and a parent that sleeps until a node ends has one event to wait on.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, engine, newRun, HOUR } from "../fixtures/seed.ts";
import { sweepWaits, wake } from "../handlers/engine.ts";

const node = (
  h: Harness,
  id: string,
): Record<string, any> | undefined => // eslint-disable-line @typescript-eslint/no-explicit-any
  h.sqlite.prepare("SELECT * FROM runs_node WHERE run_id = ?").get(id) as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
const states = (h: Harness, id: string): string[] =>
  (
    h.sqlite
      .prepare("SELECT payload_json FROM runs_event WHERE run_id = ? AND type = 'state' ORDER BY seq")
      .all(id) as Array<{ payload_json: string }>
  ).map((e) => {
    const p = JSON.parse(e.payload_json);
    return `${p.from ?? "-"}>${p.to}:${p.why}`;
  });

test("a routine, a wait and a terminal Run each get a node with the Run's own id; an automation Run does not", async () => {
  const h = harness();
  const ids: Record<string, string> = {};
  for (const kind of ["routine", "wait", "terminal", "automation"])
    ids[kind] = (await h.call("runs.start", newRun({ kind }), engine)).runId;
  for (const kind of ["routine", "wait", "terminal"]) {
    const n = node(h, ids[kind]!);
    assert.equal(n?.kind, kind);
    assert.equal(n?.status, "queued");
    assert.equal(n?.owner, alice.id);
    assert.equal(JSON.parse(n!.origin_json).mirror, "run");
  }
  assert.equal(node(h, ids["automation"]!), undefined, "flow kinds the tree does not show stay out of it");
});

test("a Run that finishes finishes its node once, with one node_ended event a sleeping parent can wait on", async () => {
  const h = harness();
  const id = (await h.call("runs.start", newRun({ kind: "terminal" }), engine)).runId;
  await h.call("runs.finish", { runId: id, status: "succeeded", summary: "Build passed" }, engine);
  assert.equal(node(h, id)?.status, "succeeded");
  assert.equal(node(h, id)?.summary, "Build passed");
  assert.ok(node(h, id)?.ended_at);
  assert.deepEqual(states(h, id), ["->queued:started", "queued>succeeded:done"]);
  const ends = h.sqlite
    .prepare("SELECT COUNT(*) AS n FROM runs_event WHERE run_id = ? AND type = 'result'")
    .get(id) as { n: number };
  assert.equal(ends.n, 1);
});

test("a wait shows what it waits for and when it gives up; waking it ends the node, and a time wait carries its due time", async () => {
  const h = harness();
  const w = (
    await h.call(
      "runs.wait_for",
      {
        on: { event: "terminal.command_finished", filter: { terminalId: "trm_1" } },
        label: "The build finishes",
        timeout: "2h",
      },
      alice,
    )
  ).runId;
  const n = node(h, w)!;
  assert.equal(n.status, "waiting");
  const wk = JSON.parse(n.wake_json);
  assert.deepEqual([wk.kind, wk.label, wk.dueAt], ["event", "The build finishes", h.now() + 2 * HOUR]);
  const t = (await h.call("runs.wait_for", { on: { at: h.now() + HOUR }, label: "9:00 tomorrow" }, alice)).runId;
  assert.deepEqual(JSON.parse(node(h, t)!.wake_json), { kind: "time", label: "9:00 tomorrow", dueAt: h.now() + HOUR });
  const woken = await h.engineRun(engine, (ctx) =>
    wake(ctx, { type: "terminal.command_finished", payload: { terminalId: "trm_1", exitCode: 0 } }),
  );
  assert.deepEqual(woken, [w]);
  assert.equal(node(h, w)?.status, "succeeded");
  assert.equal(node(h, t)?.status, "waiting", "the other sleeper is not touched");
  h.advance(HOUR + 1);
  await h.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.equal(node(h, t)?.status, "succeeded");
  assert.deepEqual(states(h, t), ["->queued:started", "queued>waiting:slept", "waiting>succeeded:done"]);
});

test("a mirrored child sits under its mirrored parent in one tree", async () => {
  const h = harness();
  const routine = (await h.call("runs.start", newRun({ kind: "routine" }), engine)).runId;
  const term = (await h.call("runs.start", newRun({ kind: "terminal", parentRun: routine }), engine)).runId;
  assert.equal(node(h, term)?.parent_run, routine);
  assert.equal(node(h, term)?.root_run, routine);
  assert.equal(node(h, term)?.depth, 1);
  const tree = await h.call("runs.tree.get", { runId: routine }, { ...alice, depth: 0 });
  assert.equal(tree.nodes.length, 2);
});

test("stop on a mirrored node goes through the Run engine; pause is refused, and the node and the Run agree", async () => {
  const h = harness();
  const w = (await h.call("runs.wait_for", { on: { event: "x.y" } }, alice)).runId;
  const e = await h.call("runs.node.control", { runId: w, action: "pause" }, { ...alice, depth: 0 }).catch((x) => x);
  assert.equal(codeOf(e), "validation.precondition_failed");
  assert.equal(reasonOf(e), "not_pausable");
  const out = await h.call(
    "runs.node.control",
    { runId: w, action: "stop", reason: "Not needed" },
    { ...alice, depth: 0 },
  );
  assert.equal(out.nodes[0].status, "stopped");
  assert.equal(((await h.call("runs.get", { runId: w }, engine)).run as { status: string }).status, "stopped");
});

test("a node a tree holds is removed with its erased Run, and a finished tree is purged with its log, a live one never", async () => {
  const h = harness();
  const a = (await h.call("runs.start", newRun({ kind: "terminal" }), engine)).runId;
  await h.call("runs.finish", { runId: a, status: "succeeded" }, engine);
  await h.call("runs.erase", { runId: a, idempotencyKey: "k1" }, { id: "usr_admin", kind: "service" });
  assert.equal(node(h, a), undefined);
  assert.equal(
    (h.sqlite.prepare("SELECT COUNT(*) AS n FROM runs_event WHERE run_id = ?").get(a) as { n: number }).n,
    0,
  );
  // a tree made through the node core: one finished, one live
  const done = (await h.call("runs.node.start", { kind: "turn", owner: alice.id }, engine)).node.id;
  await h.call("runs.node.move", { runId: done, to: "stopped", why: "stopped" }, engine);
  const live = (await h.call("runs.node.start", { kind: "turn", owner: alice.id }, engine)).node.id;
  h.advance(10 * HOUR);
  await h.call("runs.purge", { before: h.now(), idempotencyKey: "k2" }, { id: "usr_admin", kind: "service" });
  assert.equal(node(h, done), undefined);
  assert.equal(node(h, live)?.status, "queued");
});

test("a mirror never hides a failure that is not a missing table", async () => {
  const h = harness();
  h.sqlite.exec("DROP TABLE runs_event");
  // a database that predates the node tables is skipped quietly (a fixture), the other half of the guard is that real errors are thrown
  await h.call("runs.start", newRun({ kind: "terminal" }), engine);
  h.sqlite.exec("CREATE TABLE runs_event (x INTEGER)");
  await assert.rejects(() => h.call("runs.start", newRun({ kind: "terminal" }), engine));
});
