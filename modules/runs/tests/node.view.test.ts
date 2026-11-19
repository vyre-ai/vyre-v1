// Who sees what of a tree (r42-runtime slice 3): the owner sees all; another person in the chat sees that work goes on, "Helper 1", state and clock, and nothing it was asked, said, found or spent; anyone else sees nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";

const THREAD = `thr_${"a".repeat(32)}`;
const member = (who: { id: string }, action: { level: string }, res: { type: string; id: string | null }): boolean =>
  who.id === "usr_bob" && action.level === "view" && res.type === "thread" && res.id === THREAD;
const at0 = (who: { id: string; kind?: "person" | "agent" | "actor" | "service" }) => ({ ...who, depth: 0 });

async function built(h: Harness) {
  const root = (
    await h.call(
      "runs.node.start",
      { kind: "turn", owner: alice.id, threadId: THREAD, name: "Review suppliers" },
      engine,
    )
  ).node;
  const mk = async (name: string, over: Record<string, unknown> = {}) => {
    h.advance(1); // nodes started in one millisecond would be numbered by random id
    return (
      await h.call(
        "runs.node.start",
        {
          kind: "helper",
          owner: alice.id,
          parentRun: root.id,
          threadId: THREAD,
          name,
          brief: { text: "Pine quoted 3,820; check it" },
          ...over,
        },
        engine,
      )
    ).node;
  };
  const a = await mk("Calder bid");
  const b = await mk("Pine bid");
  await h.call(
    "runs.node.event",
    { runId: a.id, type: "usage", key: "u1", payload: { tokensIn: 900, tokensOut: 90, usdMicros: 4000 } },
    engine,
  );
  await h.call(
    "runs.node.event",
    { runId: a.id, type: "said", key: "s1", payload: { text: "Calder is 12 percent cheaper" } },
    engine,
  );
  await h.call(
    "runs.node.move",
    {
      ...hold(h, a.id),
      runId: a.id,
      to: "failed",
      why: "failed",
      error: { code: "no_column", message: "Numbers had no column for Pine" },
      summary: "Pine's price is 3,820",
    },
    engine,
  );
  await h.call("runs.node.claim", { runId: b.id, holder: "host:a" }, engine);
  await h.call(
    "runs.node.move",
    {
      ...hold(h, b.id),
      runId: b.id,
      to: "waiting",
      why: "slept",
      wake: { kind: "person", label: "Rubab's answer on Pine" },
    },
    engine,
  );
  return { root, a, b };
}

test("the owner sees everything", async () => {
  const h = harness();
  const { root, a } = await built(h);
  const tree = await h.call("runs.tree.get", { runId: root.id }, at0(alice));
  const got = tree.nodes.find((n: any) => n.id === a.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(got.name, "Calder bid");
  assert.equal(got.errorMessage, "Numbers had no column for Pine");
  assert.equal(got.spent.usdMicros, 4000);
  assert.equal(
    (await h.call("runs.events.list", { runId: root.id }, at0(alice))).events.some((e: any) => e.type === "said"),
    true,
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("a person in the chat sees helpers by number with state and clock, and none of what they were asked, said, found, cost or who they are", async () => {
  const h = harness({ authorize: member });
  const { root, a, b } = await built(h);
  const tree = await h.call("runs.tree.get", { runId: root.id }, at0(bob));
  assert.deepEqual(
    tree.nodes.map((n: any) => [n.name, n.status]),
    [
      ["A reply", "queued"],
      ["Helper 1", "failed"],
      ["Helper 2", "waiting"],
    ],
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = JSON.stringify(tree);
  for (const secret of [
    "Calder",
    "Pine",
    "3,820",
    "Numbers",
    "no_column",
    "Rubab",
    "4000",
    "brief",
    "result",
    "evidence",
    "errorMessage",
    "whoId",
    "model",
  ])
    assert.equal(text.includes(secret), false, `${secret} must not reach another person`);
  const waiting = tree.nodes.find((n: any) => n.id === b.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(
    waiting.wake,
    { kind: "person" },
    "it is asleep for a person; for whom and why stays with the owner",
  );
  const one = await h.call("runs.node.get", { runId: a.id }, at0(bob));
  assert.equal(one.node.name, "Helper 1");
  assert.equal(JSON.stringify(one).includes("Calder"), false);
});

test("the event stream of a person who only watches holds state changes and their time, and nothing a node said or used", async () => {
  const h = harness({ authorize: member });
  const { root } = await built(h);
  const out = await h.call("runs.events.list", { runId: root.id }, at0(bob));
  assert.ok(out.events.length > 0);
  assert.deepEqual([...new Set(out.events.map((e: any) => e.type))], ["state"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(JSON.stringify(out).includes("Pine"), false);
  assert.equal(
    out.events.every((e: any) => e.actor === undefined),
    true,
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(out.lastSeq > 0, "the cursor still advances so a reader does not ask again for what it cannot see");
});

test("a person who is not in the chat sees nothing, and cannot control what they may watch", async () => {
  const h = harness({ authorize: member });
  const { root, a } = await built(h);
  const carol = { id: "usr_carol", kind: "person" as const, depth: 0 };
  for (const cap of ["runs.tree.get", "runs.node.get", "runs.events.list"])
    assert.equal(codeOf(await h.call(cap, { runId: root.id }, carol).catch((e) => e)), "permission.not_found", cap);
  assert.equal(
    codeOf(await h.call("runs.node.control", { runId: a.id, action: "stop" }, at0(bob)).catch((e) => e)),
    "permission.not_found",
    "watching is not managing",
  );
});

test("activity: a person sees their own live work, not finished work and not another person's; a manager may ask for all", async () => {
  const h = harness({ authorize: (who, action) => who.id === "usr_admin" && action.perm === "runs.manage" });
  const { a, b } = await built(h);
  const other = (await h.call("runs.node.start", { kind: "helper", owner: bob.id, name: "Bob's" }, engine)).node;
  const mine = await h.call("runs.activity.list", {}, at0(alice));
  const ids = mine.rows.map((r: any) => r.runId); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(ids.includes(b.id));
  assert.equal(ids.includes(a.id), false, "a failed node is not running or asleep");
  assert.equal(ids.includes(other.id), false);
  assert.deepEqual(mine.rows.find((r: any) => r.runId === b.id).wake, {
    kind: "person",
    label: "Rubab's answer on Pine",
  }); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(
    codeOf(await h.call("runs.activity.list", { scope: "all" }, at0(alice)).catch((e) => e)),
    "permission.role_lacks_permission",
  );
  const all = await h.call(
    "runs.activity.list",
    { scope: "all" },
    { id: "usr_admin", kind: "person" as const, depth: 0 },
  );
  assert.ok(all.rows.map((r: any) => r.runId).includes(other.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("work in another chat that a person cannot open is not shown to them, though they may see the chat the tree began in", async () => {
  const h = harness({ authorize: member });
  const OTHER = `thr_${"f".repeat(32)}`;
  const root = (await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: THREAD }, engine)).node;
  h.advance(1);
  const here = (
    await h.call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: root.id, threadId: THREAD }, engine)
  ).node;
  h.advance(1);
  const there = (
    await h.call("runs.node.start", { kind: "helper", owner: alice.id, parentRun: root.id, threadId: OTHER }, engine)
  ).node;
  const tree = await h.call("runs.tree.get", { runId: root.id }, at0(bob));
  const ids = tree.nodes.map((n: any) => n.id); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(ids.includes(here.id));
  assert.equal(ids.includes(there.id), false);
});
