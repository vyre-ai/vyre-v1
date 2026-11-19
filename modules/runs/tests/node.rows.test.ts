// What a tile says about a node (r42-runtime): the one current step, the approval it waits on, why it looks stuck, who works, and what it starts after; and what a person who only watches the chat is never told of any of it.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";
import { detectStuck, settleDeps } from "../node.ts";

const host = { id: "svc_host", kind: "service" as const };
const THREAD = `thr_${"a".repeat(32)}`;
const owner = { ...alice, depth: 0 };
const watcher = (who: { id: string }, action: { level: string }, res: { type: string }): boolean =>
  who.id === "usr_bob" && action.level === "view" && res.type === "thread";
const start = async (h: Harness, over: Record<string, unknown> = {}) => {
  h.advance(1);
  return (await h.call("runs.node.start", { kind: "helper", owner: alice.id, threadId: THREAD, ...over }, engine))
    .node as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const statusOf = (h: Harness, id: string): string =>
  String((h.sqlite.prepare("SELECT status FROM runs_node WHERE run_id = ?").get(id) as { status: string }).status);

test("the current step is the last step event, with its icon and plain words; an icon that is not in the set is not kept", async () => {
  const h = harness();
  const n = await start(h, { running: true, whoName: "Calder" });
  await h.call(
    "runs.node.event",
    { runId: n.id, type: "step", payload: { icon: "read", text: "Reading the price sheet" } },
    engine,
  );
  await h.call(
    "runs.node.event",
    { runId: n.id, type: "step", payload: { icon: "term", text: "Running a command" } },
    engine,
  );
  await h.call("runs.node.event", { runId: n.id, type: "step", payload: { icon: "sparkles", text: "Nope" } }, engine);
  const got = (await h.call("runs.node.get", { runId: n.id }, owner)).node;
  assert.deepEqual(got.step, { icon: "term", text: "Running a command" });
  assert.equal(got.whoName, "Calder");
  const row = (await h.call("runs.activity.list", {}, owner)).rows.find((r: any) => r.runId === n.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(row.step, { icon: "term", text: "Running a command" });
  assert.equal(row.whoName, "Calder");
});

test("an approval a node waits on is its need while it waits, and is gone the moment it moves on", async () => {
  const h = harness();
  const n = await start(h, { running: true });
  await h.call(
    "runs.node.move",
    { runId: n.id, to: "waiting", why: "slept", wake: { kind: "person", label: "your answer", on: { task: "tsk_1" } } },
    engine,
  );
  await h.call(
    "runs.node.event",
    {
      runId: n.id,
      type: "need",
      key: "need:tsk_1",
      payload: { requestId: "tsk_1", what: "Sending an email", why: "It needs your yes before it goes ahead." },
    },
    engine,
  );
  assert.deepEqual((await h.call("runs.node.get", { runId: n.id }, owner)).node.need, {
    requestId: "tsk_1",
    what: "Sending an email",
    why: "It needs your yes before it goes ahead.",
  });
  await h.call("runs.node.move", { runId: n.id, to: "queued", why: "woke" }, engine);
  assert.equal((await h.call("runs.node.get", { runId: n.id }, owner)).node.need, undefined);
});

test("a node that starts after another is not taken until it has succeeded, and fails, saying which, when that one does not", async () => {
  const h = harness();
  const root = await start(h, { kind: "turn" });
  const research = await start(h, { parentRun: root.id, name: "Research" });
  const docs = await start(h, { parentRun: root.id, name: "Docs", dependsOn: [research.id] });
  assert.deepEqual((await h.call("runs.node.get", { runId: docs.id }, owner)).node.dependsOn, [research.id]);
  assert.equal(
    (await h.call("runs.node.claim", { runId: docs.id, holder: "host:a" }, host)).node,
    undefined,
    "not before Research is done",
  );
  await h.call("runs.node.claim", { runId: research.id, holder: "host:a" }, host);
  await h.call("runs.node.move", { runId: research.id, to: "succeeded", why: "done", ...hold(h, research.id) }, engine);
  assert.equal((await h.call("runs.node.claim", { runId: docs.id, holder: "host:a" }, host)).node.status, "running");
  // the other way: Research fails, Docs never starts
  const r2 = await start(h, { parentRun: root.id, name: "Numbers" });
  const d2 = await start(h, { parentRun: root.id, name: "Report", dependsOn: [r2.id] });
  await h.call(
    "runs.node.move",
    { runId: r2.id, to: "failed", why: "failed", error: { code: "x", message: "no column" } },
    engine,
  );
  await h.engineRun(host, async (ctx) => settleDeps(ctx));
  assert.equal(statusOf(h, d2.id), "failed");
  const e = (await h.call("runs.node.get", { runId: d2.id }, owner)).node;
  assert.equal(e.errorCode, "dependency_failed");
  assert.match(e.errorMessage, /Numbers/);
});

test("a dependency must be work of the same job, and a node that is already running cannot wait for another", async () => {
  const h = harness();
  const a = await start(h, { kind: "turn" });
  const b = await start(h, { kind: "turn" });
  const k = await start(h, { parentRun: a.id });
  assert.equal(
    reasonOf(
      await h
        .call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: a.id, dependsOn: [b.id] }, engine)
        .catch((e) => e),
    ),
    "bad_dependency",
  );
  assert.equal(
    reasonOf(
      await h
        .call(
          "runs.node.start",
          { kind: "helper", owner: alice.id, parentRun: a.id, dependsOn: [k.id], running: true },
          engine,
        )
        .catch((e) => e),
    ),
    "running_with_dependency",
  );
});

test("a node with no news for ten minutes, or the same step four times, is marked stuck with a plain reason and nudged; any sign of life clears it", async () => {
  const h = harness();
  const quiet = await start(h, { running: true });
  const loop = await start(h, { running: true });
  for (let i = 0; i < 4; i++)
    await h.call(
      "runs.node.event",
      { runId: loop.id, type: "step", payload: { icon: "read", text: "Reading a file" } },
      engine,
    );
  h.advance(11 * 60_000);
  await h.call(
    "runs.node.event",
    { runId: loop.id, type: "step", payload: { icon: "read", text: "Reading a file" } },
    engine,
  );
  const marked = await h.engineRun(host, async (ctx) => detectStuck(ctx));
  assert.deepEqual(marked.map((n) => n.id).sort(), [quiet.id, loop.id].sort());
  const q = (await h.call("runs.node.get", { runId: quiet.id }, owner)).node;
  assert.match(q.stuck.reason, /Nothing new for 11 minutes/);
  const l = (await h.call("runs.node.get", { runId: loop.id }, owner)).node;
  assert.match(l.stuck.reason, /same step 4 times/);
  const nudge = h.sqlite.prepare("SELECT body FROM runs_message WHERE to_run = ?").all(quiet.id) as Array<{
    body: string;
  }>;
  assert.equal(nudge.length, 1);
  assert.match(nudge[0]!.body, /stuck/);
  assert.equal((await h.engineRun(host, async (ctx) => detectStuck(ctx))).length, 0, "marked once, nudged once");
  await h.call(
    "runs.node.event",
    { runId: quiet.id, type: "step", payload: { icon: "find", text: "Looking for the right tool" } },
    engine,
  );
  assert.equal((await h.call("runs.node.get", { runId: quiet.id }, owner)).node.stuck, undefined);
});

test("a node that sleeps or has finished is never called stuck", async () => {
  const h = harness();
  const asleep = await start(h, { running: true });
  await h.call(
    "runs.node.move",
    { runId: asleep.id, to: "waiting", why: "slept", wake: { kind: "time", dueAt: h.now() + 3_600_000 } },
    engine,
  );
  const done = await start(h, { running: true });
  await h.call("runs.node.move", { runId: done.id, to: "succeeded", why: "done" }, engine);
  h.advance(60 * 60_000);
  assert.equal((await h.engineRun(host, async (ctx) => detectStuck(ctx))).length, 0);
});

test("a person who only watches the chat is told none of it: no step, need, stuck, name or dependency", async () => {
  const h = harness({ authorize: watcher });
  const root = await start(h, { kind: "turn" });
  const n = await start(h, { parentRun: root.id, running: true, whoName: "Calder", name: "Calder bid" });
  await h.call(
    "runs.node.event",
    { runId: n.id, type: "step", payload: { icon: "read", text: "Reading Pine's quote" } },
    engine,
  );
  await h.call(
    "runs.node.move",
    { runId: n.id, to: "waiting", why: "slept", wake: { kind: "person", label: "Rubab's yes" } },
    engine,
  );
  await h.call(
    "runs.node.event",
    { runId: n.id, type: "need", payload: { requestId: "tsk_secret_9", what: "Sending an email to Pine", why: "x" } },
    engine,
  );
  const seen = JSON.stringify(await h.call("runs.tree.get", { runId: root.id }, { ...bob, depth: 0 }));
  for (const secret of [
    "Calder",
    "Pine",
    "Rubab",
    "Reading",
    "tsk_secret_9",
    "step",
    "need",
    "stuck",
    "whoName",
    "dependsOn",
  ])
    assert.equal(seen.includes(secret), false, secret);
  assert.equal(
    codeOf(
      await h.call("runs.node.get", { runId: n.id }, { id: "usr_carol", kind: "person", depth: 0 }).catch((e) => e),
    ),
    "permission.not_found",
  );
});
