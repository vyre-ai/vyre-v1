// A helper that starts after others of its chat (r42-runtime): its node is made queued behind theirs, by their threads; a helper not yet seen gets a queued node under the key its own first turn takes over; the first turn becomes that node and runs only when they are done.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, hold, reasonOf } from "../fixtures/db.ts";
import { alice, engine } from "../fixtures/seed.ts";
import { settleDeps } from "../node.ts";

const owner = { ...alice, depth: 0 };
const T = (c: string) => `thr_${c.repeat(32)}`;
const MAIN = T("a");
const NUMBERS = T("b");
const DOCS = T("c");

const rig = async () => {
  const h = harness();
  h.advance(1);
  const root = (
    await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: MAIN, running: true }, engine)
  ).node as { id: string };
  return { h, root };
};
const statusOf = (h: Awaited<ReturnType<typeof rig>>["h"], id: string) =>
  String((h.sqlite.prepare("SELECT status FROM runs_node WHERE run_id = ?").get(id) as { status: string }).status);

test("by thread: the helper it waits for that already ran is found; one not seen yet gets a queued node under its own key; the waiting one is queued behind both", async () => {
  const { h, root } = await rig();
  h.advance(1);
  const numbers = (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: NUMBERS, parentThread: MAIN, running: true },
      engine,
    )
  ).node as { id: string };
  const docs = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: DOCS,
        parentThread: MAIN,
        name: "Docs",
        dependsOnThreads: [NUMBERS, T("d")],
        idemKey: `helper:${DOCS}`,
      },
      engine,
    )
  ).node as { id: string; status: string; dependsOn: string[]; rootRun: string };
  assert.equal(docs.status, "queued");
  assert.equal(docs.rootRun, root.id);
  assert.equal(docs.dependsOn.length, 2);
  assert.ok(docs.dependsOn.includes(numbers.id));
  const unseen = docs.dependsOn.find((x) => x !== numbers.id)!;
  assert.equal(statusOf(h, unseen), "queued", "a placeholder for the helper not seen yet");
  const seen = (await h.call("runs.node.get", { runId: docs.id }, owner)).node;
  assert.deepEqual([...seen.dependsOn].sort(), [...docs.dependsOn].sort());
});

test("its first turn takes the queued node over and runs it only when what it waits for has succeeded; until then it is refused; a helper that was waited for takes over its own placeholder", async () => {
  const { h } = await rig();
  h.advance(1);
  const numbers = (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: NUMBERS, parentThread: MAIN, running: true },
      engine,
    )
  ).node as { id: string };
  const docs = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: DOCS,
        parentThread: MAIN,
        dependsOnThreads: [NUMBERS],
        idemKey: `helper:${DOCS}`,
      },
      engine,
    )
  ).node as { id: string };
  const take = () =>
    h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: DOCS,
        parentThread: MAIN,
        running: true,
        adoptKey: `helper:${DOCS}`,
        idemKey: "turn:t1",
      },
      engine,
    );
  assert.equal(reasonOf(await take().catch((e) => e)), "dependency_unmet");
  assert.equal(statusOf(h, docs.id), "queued");
  await h.call("runs.node.move", { ...hold(h, numbers.id), runId: numbers.id, to: "succeeded", why: "done" }, engine);
  const got = await take();
  assert.equal(got.node.id, docs.id, "the same node");
  assert.equal(got.created, false);
  assert.equal(got.node.status, "running");
  assert.equal(
    (
      await h.call(
        "runs.node.start",
        { kind: "helper", owner: alice.id, threadId: DOCS, running: true, idemKey: "turn:t1" },
        engine,
      )
    ).node.id,
    docs.id,
    "a restarted caller finds it under its turn key",
  );

  // a helper that others waited for, and that was not seen when they were made: its first turn is its placeholder
  const late = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: T("e"),
        parentThread: MAIN,
        dependsOnThreads: [T("f")],
        idemKey: `helper:${T("e")}`,
      },
      engine,
    )
  ).node as { dependsOn: string[] };
  const holder = late.dependsOn[0]!;
  const f = await h.call(
    "runs.node.start",
    {
      kind: "helper",
      owner: alice.id,
      threadId: T("f"),
      parentThread: MAIN,
      running: true,
      adoptKey: `helper:${T("f")}`,
      idemKey: "turn:t2",
    },
    engine,
  );
  assert.equal(f.node.id, holder);
  assert.equal(f.node.status, "running");
});

test("a node made for a helper that never ran is failed when what it waits for fails", async () => {
  const { h } = await rig();
  h.advance(1);
  const numbers = (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: NUMBERS, parentThread: MAIN, running: true },
      engine,
    )
  ).node as { id: string };
  const docs = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: DOCS,
        parentThread: MAIN,
        dependsOnThreads: [NUMBERS],
        idemKey: `helper:${DOCS}`,
      },
      engine,
    )
  ).node as { id: string };
  await h.call(
    "runs.node.move",
    { ...hold(h, numbers.id), runId: numbers.id, to: "failed", why: "failed", error: { code: "x", message: "no" } },
    engine,
  );
  await h.engineRun({ id: "svc_host", kind: "service" as const }, async (ctx) => settleDeps(ctx));
  assert.equal(statusOf(h, docs.id), "failed");
});

test("a helper made after the one it waits for had already failed is failed at once, naming it, and never left queued", async () => {
  const { h } = await rig();
  h.advance(1);
  const numbers = (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: NUMBERS, parentThread: MAIN, name: "Numbers", running: true },
      engine,
    )
  ).node as { id: string };
  await h.call(
    "runs.node.move",
    { ...hold(h, numbers.id), runId: numbers.id, to: "failed", why: "failed", error: { code: "x", message: "no" } },
    engine,
  );
  const docs = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: DOCS,
        parentThread: MAIN,
        dependsOnThreads: [NUMBERS],
        idemKey: `helper:${DOCS}`,
      },
      engine,
    )
  ).node as { id: string; status: string };
  const got = (await h.call("runs.node.get", { runId: docs.id }, owner)).node;
  assert.equal(got.status, "failed", "failed straight away, with no sweep");
  assert.equal(got.errorCode, "dependency_failed");
  assert.equal(got.reason, "Didn't start because Numbers failed.");
});

test("several failed dependencies are named together in one short sentence", async () => {
  const { h } = await rig();
  h.advance(1);
  const mk = async (thread: string, name: string) =>
    (
      await h.call(
        "runs.node.start",
        { kind: "helper", owner: alice.id, threadId: thread, parentThread: MAIN, name, running: true },
        engine,
      )
    ).node as { id: string };
  const a = await mk(NUMBERS, "Gamma");
  const b = await mk(T("g"), "Alpha");
  for (const n of [a, b])
    await h.call(
      "runs.node.move",
      { ...hold(h, n.id), runId: n.id, to: "failed", why: "failed", error: { code: "x", message: "no" } },
      engine,
    );
  const docs = (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: DOCS, parentThread: MAIN, dependsOnThreads: [NUMBERS, T("g")] },
      engine,
    )
  ).node as { id: string };
  const got = (await h.call("runs.node.get", { runId: docs.id }, owner)).node;
  assert.match(got.reason, /^Didn't start because (Alpha and Gamma|Gamma and Alpha) failed\.$/);
});

const mkHelper = async (
  h: Awaited<ReturnType<typeof rig>>["h"],
  thread: string,
  name: string,
  extra: Record<string, unknown> = {},
) =>
  (
    await h.call(
      "runs.node.start",
      { kind: "helper", owner: alice.id, threadId: thread, parentThread: MAIN, name, ...extra },
      engine,
    )
  ).node as { id: string; status: string; dependsOn?: string[] };
const failIt = (h: Awaited<ReturnType<typeof rig>>["h"], id: string) =>
  h.call(
    "runs.node.move",
    { ...hold(h, id), runId: id, to: "failed", why: "failed", error: { code: "x", message: "no" } },
    engine,
  );

test("a retry of a failed helper brings back the helpers that failed only because of it, and theirs after them: one Retry repairs the chain; if the retry fails too they fail again with the same words", async () => {
  const { h } = await rig();
  h.advance(1);
  const gamma = await mkHelper(h, NUMBERS, "Gamma", { running: true });
  await failIt(h, gamma.id);
  const delta = await mkHelper(h, DOCS, "Delta", { dependsOnThreads: [NUMBERS], idemKey: `helper:${DOCS}` });
  const zeta = await mkHelper(h, T("z"), "Zeta", { dependsOnThreads: [DOCS], idemKey: `helper:${T("z")}` });
  const other = await mkHelper(h, T("o"), "Other", { running: true });
  await failIt(h, other.id);
  assert.deepEqual([statusOf(h, delta.id), statusOf(h, zeta.id)], ["failed", "failed"]);

  // Gamma is tried again: a new helper, told it retries the one that failed
  h.advance(1);
  const again = await mkHelper(h, T("r"), "Gamma", { retriesThread: NUMBERS, idemKey: `helper:${T("r")}` });
  assert.equal(statusOf(h, delta.id), "queued", "Delta waits again");
  assert.equal(statusOf(h, zeta.id), "queued", "and Zeta, which failed because of Delta");
  assert.equal(statusOf(h, other.id), "failed", "one that did not wait for it is left alone");
  const d = (await h.call("runs.node.get", { runId: delta.id }, owner)).node;
  assert.deepEqual(d.dependsOn, [again.id], "now on the new attempt");
  assert.equal(d.reason, undefined, "its old failure is gone");

  // the new Gamma succeeds: Delta can start; its work runs, then Zeta can
  await h.call("runs.node.claim", { runId: again.id, holder: "host:a" }, engine);
  await h.call("runs.node.move", { ...hold(h, again.id), runId: again.id, to: "succeeded", why: "done" }, engine);
  const start = (thread: string, key: string) =>
    h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: thread,
        parentThread: MAIN,
        running: true,
        adoptKey: `helper:${thread}`,
        idemKey: key,
      },
      engine,
    );
  assert.equal((await start(DOCS, "turn:d1")).node.id, delta.id, "Delta's turn takes its node over");
  await h.call("runs.node.move", { ...hold(h, delta.id), runId: delta.id, to: "succeeded", why: "done" }, engine);
  assert.equal((await start(T("z"), "turn:z1")).node.id, zeta.id);
  assert.equal(statusOf(h, zeta.id), "running");
});

test("if the retry fails too, the helpers that waited for it fail again with the same reason", async () => {
  const { h } = await rig();
  h.advance(1);
  const gamma = await mkHelper(h, NUMBERS, "Gamma", { running: true });
  await failIt(h, gamma.id);
  const delta = await mkHelper(h, DOCS, "Delta", { dependsOnThreads: [NUMBERS], idemKey: `helper:${DOCS}` });
  h.advance(1);
  const again = await mkHelper(h, T("r"), "Gamma", {
    retriesThread: NUMBERS,
    idemKey: `helper:${T("r")}`,
    running: true,
  });
  assert.equal(statusOf(h, delta.id), "queued");
  await failIt(h, again.id);
  await h.engineRun({ id: "svc_host", kind: "service" as const }, async (ctx) => settleDeps(ctx));
  const d = (await h.call("runs.node.get", { runId: delta.id }, owner)).node;
  assert.equal(d.status, "failed");
  assert.equal(d.reason, "Didn't start because Gamma failed.");
});
