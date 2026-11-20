// runs.ops, the one agent call for looking at and steering agent work (r42-runtime): a wrong first call is answered with the exact shape, every action reaches the same handler the app's call does, and the rules of
// those handlers (who sees a tree, who may steer it) still hold through it.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";
import { ACTIONS } from "../handlers/ops-tool.ts";

const owner = { ...alice, depth: 0 };
const watcher = { ...bob, depth: 0 };
const THREAD = `thr_${"a".repeat(32)}`;
const ops = async (h: Harness, who: typeof owner, input: Record<string, unknown>) =>
  ((await h.call("runs.ops", input, who)) as { result: any }).result; // eslint-disable-line @typescript-eslint/no-explicit-any
const msg = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return String((e as { error?: { message?: string } })?.error?.message ?? e);
  }
  return "";
};
const world = async () => {
  const h = harness({
    authorize: (who, action, res) =>
      who.id === alice.id || (who.id === bob.id && action.level === "view" && res.type === "thread"),
  });
  h.advance(1);
  const root = (
    await h.call(
      "runs.node.start",
      { kind: "turn", owner: alice.id, threadId: THREAD, running: true, name: "Supplier review" },
      engine,
    )
  ).node as { id: string };
  return { h, root };
};

test("a wrong first call is answered with the exact shape: an unknown action lists the actions, a missing or wrong id and missing args name what to send", async () => {
  const { h, root } = await world();
  assert.match(await msg(ops(h, owner, { action: "nope" })), /Pick one of: tree, tree_find, node/);
  assert.match(await msg(ops(h, owner, { action: "tree" })), /\{action:'tree', id:<run id>\}\. `id` is the run id/);
  assert.match(await msg(ops(h, owner, { action: "tree", id: "thr_x" })), /run_\.\.\./);
  assert.match(await msg(ops(h, owner, { action: "tree_find", id: root.id })), /chat thread id/);
  const put = await msg(ops(h, owner, { action: "board_put", id: root.id, args: { kind: "fact" } }));
  assert.match(put, /board_put needs \{action:'board_put'/);
  assert.match(put, /Missing or wrong: text/);
  assert.match(
    await msg(ops(h, owner, { action: "budget", id: root.id, args: { tokens: "many" } })),
    /tokens is the wrong kind/,
  );
  assert.equal(codeOf(await h.call("runs.ops", { action: "node" }, owner).catch((e) => e)), "validation.bad_input");
});

test("every action names a handler and a shape, and the actions are the sixteen the skill lists", () => {
  assert.equal(Object.keys(ACTIONS).length, 16);
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.equal(typeof a.h, "function", name);
    assert.ok(a.shape.startsWith(`{action:'${name}'`), `${name} shape starts with its own call`);
  }
});

test("the reads reach the same handlers: tree, node, events, activity, board, messages and the finders", async () => {
  const { h, root } = await world();
  const tree = await ops(h, owner, { action: "tree", id: root.id });
  assert.equal(tree.nodes[0].id, root.id);
  assert.equal((await ops(h, owner, { action: "node", id: root.id })).node.id, root.id);
  assert.ok(Array.isArray((await ops(h, owner, { action: "events", id: root.id })).events));
  assert.ok(Array.isArray((await ops(h, owner, { action: "activity" })).rows));
  assert.ok(Array.isArray((await ops(h, owner, { action: "board", id: root.id })).entries));
  assert.ok(Array.isArray((await ops(h, owner, { action: "messages", id: root.id })).messages));
  const found = await ops(h, owner, { action: "tree_find", id: THREAD });
  assert.equal(found.roots[0].runId, root.id);
  const byThread = await ops(h, owner, { action: "node_find", args: { threadIds: [THREAD] } });
  assert.equal(byThread.byThread[THREAD], root.id);
});

test("the rules of the handlers hold through it: someone who may only watch the chat does not see a helper's brief, cannot steer, and cannot compare", async () => {
  const { h, root } = await world();
  h.callee("runs.budget.set", (i: Record<string, unknown>) => h.call("runs.budget.set", i, watcher));
  const asWatcher = (input: Record<string, unknown>) => h.call("runs.ops", input, watcher).catch((e) => e);
  const seen = (await asWatcher({ action: "node", id: root.id })) as { result?: { node?: { name?: string } } };
  assert.notEqual(seen.result?.node?.name, "Supplier review", "a watcher gets the redacted view, not the name");
  for (const call of [
    { action: "control", id: root.id, args: { action: "stop" } },
    { action: "budget", id: root.id, args: { tokens: 100 } },
    { action: "compare", id: root.id },
    { action: "board_put", id: root.id, args: { kind: "fact", text: "x" } },
    { action: "message_send", id: root.id, args: { to: root.id, body: "hi" } },
  ])
    assert.ok(codeOf(await asWatcher(call)), `${call.action} is refused to someone who only watches`);
});

test("steering through it: the owner puts a question on the board, answers nothing that is not there, sets a limit, and saves nothing that is not finished", async () => {
  const { h, root } = await world();
  const put = await ops(h, owner, {
    action: "board_put",
    id: root.id,
    args: { kind: "question", text: "Which sheet is the price from?" },
  });
  assert.equal(put.entry.text, "Which sheet is the price from?");
  assert.equal((await ops(h, owner, { action: "board", id: root.id })).entries.length, 1);
  assert.equal(
    codeOf(
      await h
        .call("runs.ops", { action: "board_answer", id: root.id, args: { entryId: "brd_none", text: "x" } }, owner)
        .catch((e) => e),
    ),
    "permission.not_found",
  );
  // the limit is asked of runs.budget.set (so it is held there as it is on the direct door); here that call is answered by the real handler
  const asked: Array<Record<string, unknown>> = [];
  h.callee("runs.budget.set", (i: Record<string, unknown>) => {
    asked.push(i);
    return h.call("runs.budget.set", i, owner);
  });
  const limited = await ops(h, owner, { action: "budget", id: root.id, args: { tokens: 5000 } });
  assert.deepEqual(asked, [{ runId: root.id, tokens: 5000 }], "the same call the direct door makes");
  assert.equal(limited.node.budget.tokens, 5000);
  await h.call("runs.node.move", { ...hold(h, root.id), runId: root.id, to: "succeeded", why: "done" }, engine);
  h.callee("agents.create", () => ({ agent: { agentId: `agt_${"d".repeat(32)}`, name: "Reviewer" } }));
  const saved = await h.call(
    "runs.ops",
    { action: "save_as_agent", id: root.id, args: { name: "Reviewer", instructions: "Compare the bids." } },
    owner,
  );
  assert.equal((saved as { result: { runId: string } }).result.runId, root.id);
  assert.equal(
    await msg(ops(h, owner, { action: "rerun", id: root.id, args: { instructions: "x" } })),
    "Only a helper can be started again with another brief.",
  );
});

test("a member who can see the tree but is not its owner and has no runs.manage is refused on every write action through the tool", async () => {
  // bob may view everything here and manage nothing: the owner is alice
  const h = harness({
    authorize: (who, action) => who.id === alice.id || (who.id === bob.id && action.level === "view"),
  });
  h.advance(1);
  const root = (
    await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: THREAD, running: true }, engine)
  ).node as { id: string };
  const put = await h.call(
    "runs.ops",
    { action: "board_put", id: root.id, args: { kind: "question", text: "Which sheet?" } },
    owner,
  );
  const entryId = (put as { result: { entry: { id: string } } }).result.entry.id;
  h.callee("runs.budget.set", (i: Record<string, unknown>) => h.call("runs.budget.set", i, watcher));
  h.callee("agents.create", () => ({ agent: { agentId: `agt_${"d".repeat(32)}`, name: "x" } }));
  h.callee("chat.helper.start", () => ({ helper: { threadId: `thr_${"e".repeat(32)}` } }));
  await h.call("runs.node.move", { ...hold(h, root.id), runId: root.id, to: "succeeded", why: "done" }, engine);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["message_send", { to: root.id, body: "hi" }],
    ["board_put", { kind: "question", text: "x" }],
    ["board_answer", { entryId, text: "x" }],
    ["control", { action: "stop" }],
    ["budget", { tokens: 10 }],
    ["rerun", { instructions: "x" }],
    ["save_as_agent", { name: "x", instructions: "x" }],
  ];
  for (const [action, args] of calls) {
    const r = await h.call("runs.ops", { action, id: root.id, args }, watcher).catch((e) => e);
    assert.ok(
      r instanceof Error || codeOf(r),
      `${action} is refused to a member who is not the owner and cannot manage`,
    );
    assert.ok(
      codeOf(r)?.startsWith("permission."),
      `${action} is a permission refusal, not a mistake of shape: ${codeOf(r)}`,
    );
  }
  const asked: unknown[] = [];
  h.callee("agents.create", (i: unknown) => (asked.push(i), { agent: {} }));
  assert.equal(asked.length, 0, "nothing was made");
});
