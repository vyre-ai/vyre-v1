// Save as agent, re-run with a changed brief, and the two side by side (r42-runtime slice 7): only for the owner of the work or a manager, only once it has finished, never for someone who only watches the chat.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness, hold, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, engine } from "../fixtures/seed.ts";

const owner = { ...alice, depth: 0 };
const watcher = { ...bob, depth: 0 };
const PARENT = `thr_${"a".repeat(32)}`;
const HELPER = `thr_${"b".repeat(32)}`;
const AGAIN = `thr_${"c".repeat(32)}`;
const AGENT = `agt_${"d".repeat(32)}`;

type Seen = { created: Array<Record<string, unknown>>; started: Array<Record<string, unknown>> };
function rig(first: string | undefined = "Price the Calder bid from the 2025 sheet. Quote the page.") {
  const seen: Seen = { created: [], started: [] };
  const h = harness({ authorize: (who) => who.id === alice.id });
  h.callee("agents.create", (i: Record<string, unknown>) => {
    seen.created.push(i);
    return { agent: { agentId: AGENT, name: String(i["name"]) } };
  });
  h.callee("chat.helper.start", (i: Record<string, unknown>) => {
    seen.started.push(i);
    return { helper: { threadId: AGAIN }, blockId: "blk_1" };
  });
  h.callee("chat.messages.list", (i: { threadId: string; after?: number }) => ({
    messages:
      i.threadId === HELPER && i.after === 0 && first !== undefined
        ? [{ body: first, threadSeq: 1 }]
        : i.threadId === HELPER && i.after === undefined
          ? [{ body: "Calder bid: $41,200 (page 7).", threadSeq: 2 }]
          : [],
    hasMore: false,
  }));
  return { h, seen };
}
async function helper(h: Harness, over: Record<string, unknown> = {}, finish: "succeeded" | "none" = "succeeded") {
  h.advance(1);
  const root = (
    await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: PARENT, running: true }, engine)
  ).node as { id: string };
  h.advance(1);
  const input: Record<string, unknown> = {
    kind: "helper",
    owner: alice.id,
    parentRun: root.id,
    threadId: HELPER,
    running: true,
    name: "Price the Calder bid",
    model: "gpt-5-mini",
    whoKind: "agent",
    whoId: AGENT,
    ...over,
  };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  const n = (await h.call("runs.node.start", input, engine)).node as { id: string };
  if (finish === "succeeded") {
    h.advance(42_000);
    await h.call("runs.node.move", { ...hold(h, n.id), runId: n.id, to: "succeeded", why: "done" }, engine);
  }
  return { root, n };
}

test("save as agent: a finished node's brief, model and tools become the new agent, made by agents.create for the person who asks", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, {
    brief: { goal: "Price the Calder bid", instructions: "Use the 2025 sheet. Quote the page." },
    policy: { tools: { allowed: ["web_search"], denied: ["mail_send"] } },
  });
  const out = await h.call("runs.node.save_as_agent", { runId: n.id, name: "Bid pricer" }, owner);
  assert.equal(out.agent.agentId, AGENT);
  assert.equal(out.runId, n.id);
  const made = seen.created[0]!;
  assert.equal(made["name"], "Bid pricer");
  assert.equal(made["model"], "gpt-5-mini");
  assert.match(String(made["instructions"]), /Use the 2025 sheet/);
  assert.deepEqual(made["tools"], { allowed: ["web_search"], denied: ["mail_send"] });
  assert.equal(made["role"], "Price the Calder bid");
});

test("save as agent: a helper with no stored brief uses what it was told in its chat; work with no brief at all, work still going and someone who only watches are refused", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h);
  await h.call("runs.node.save_as_agent", { runId: n.id }, owner);
  assert.match(String(seen.created[0]!["instructions"]), /Price the Calder bid from the 2025 sheet/);
  assert.equal(seen.created[0]!["name"], "Price the Calder bid", "named from the work when no name is given");

  const none = rig("");
  const bare = await helper(none.h, { name: undefined });
  assert.equal(
    reasonOf(await none.h.call("runs.node.save_as_agent", { runId: bare.n.id, name: "X" }, owner).catch((e) => e)),
    "no_brief",
  );
  assert.equal(none.seen.created.length, 0);

  const live = rig();
  const going = await helper(live.h, { brief: { goal: "x" } }, "none");
  assert.equal(
    reasonOf(await live.h.call("runs.node.save_as_agent", { runId: going.n.id, name: "X" }, owner).catch((e) => e)),
    "not_finished",
  );
  const w = await h.call("runs.node.save_as_agent", { runId: n.id, name: "X" }, watcher).catch((e) => e);
  assert.ok(["permission.not_found", "permission.role_lacks_permission"].includes(codeOf(w) ?? ""), "a watcher cannot");
  assert.equal(seen.created.length, 1, "nothing more was made");
});

test("re-run: the same helper starts again beside the first in its chat with the edited brief and model; the first is kept; compare reads both", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, { brief: { goal: "Price the Calder bid", instructions: "Use the 2025 sheet." } });
  const out = await h.call(
    "runs.node.rerun",
    { runId: n.id, instructions: "Use the 2026 sheet. Quote the page.", model: "claude-sonnet-5-5" },
    owner,
  );
  assert.equal(out.threadId, AGAIN);
  assert.equal(out.rerunOf, n.id);
  const st = seen.started[0]!;
  assert.equal(st["threadId"], PARENT, "in the chat the first one was started in");
  assert.equal(st["instruction"], "Use the 2026 sheet. Quote the page.");
  assert.equal(st["model"], "claude-sonnet-5-5");
  assert.equal(st["agentId"], AGENT);

  // before the new one has taken its first turn
  let c = await h.call("runs.node.compare", { runId: n.id }, owner);
  assert.equal(c.sides.length, 2);
  assert.equal(c.sides[0].status, "succeeded");
  assert.equal(c.sides[0].brief.instructions, "Use the 2025 sheet.");
  assert.equal(c.sides[0].seconds, 42);
  assert.match(c.sides[0].result, /\$41,200/);
  assert.equal(c.sides[1].status, "queued");
  assert.equal(c.sides[1].threadId, AGAIN);

  // after it ran: its own node, brief, result, cost and time
  h.advance(1);
  const second = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        threadId: AGAIN,
        running: true,
        model: "claude-sonnet-5-5",
        brief: { goal: "Price the Calder bid", instructions: "Use the 2026 sheet. Quote the page." },
      },
      engine,
    )
  ).node as { id: string };
  await h.call(
    "runs.node.event",
    { runId: second.id, type: "usage", key: "u1", payload: { tokensIn: 900, tokensOut: 100, usdMicros: 12_000 } },
    engine,
  );
  h.advance(10_000);
  await h.call(
    "runs.node.move",
    { ...hold(h, second.id), runId: second.id, to: "succeeded", why: "done", result: "Calder bid: $39,900 (page 9)." },
    engine,
  );
  c = await h.call("runs.node.compare", { runId: n.id }, owner);
  assert.equal(c.sides[1].runId, second.id);
  assert.equal(c.sides[1].result, "Calder bid: $39,900 (page 9).");
  assert.equal(c.sides[1].usdMicros, 12_000);
  assert.equal(c.sides[1].tokens, 1000);
  assert.equal(c.sides[1].seconds, 10);
  assert.equal(c.sides[1].brief.instructions, "Use the 2026 sheet. Quote the page.");
  assert.equal(
    (await h.call("runs.node.get", { runId: n.id }, owner)).node.status,
    "succeeded",
    "the first one is as it was",
  );
});

test("re-run is refused when nothing changed, when the work is still going, when it is not a helper, and for someone who only watches; compare is not for a watcher", async () => {
  const { h, seen } = rig();
  const { n, root } = await helper(h, { brief: { goal: "g", instructions: "same" } });
  assert.equal(
    reasonOf(await h.call("runs.node.rerun", { runId: n.id, instructions: "same" }, owner).catch((e) => e)),
    "nothing_changed",
  );
  assert.equal(
    reasonOf(await h.call("runs.node.rerun", { runId: root.id, instructions: "other" }, owner).catch((e) => e)),
    "not_finished",
    "a turn that is still going",
  );
  const going = await helper(h, { brief: { goal: "g" } }, "none");
  assert.equal(
    reasonOf(await h.call("runs.node.rerun", { runId: going.n.id, instructions: "x" }, owner).catch((e) => e)),
    "not_finished",
  );
  const sub = (
    await h.call("runs.node.start", { kind: "subagent", owner: alice.id, running: true, threadId: PARENT }, engine)
  ).node as { id: string };
  h.advance(1);
  await h.call("runs.node.move", { ...hold(h, sub.id), runId: sub.id, to: "succeeded", why: "done" }, engine);
  assert.equal(
    reasonOf(await h.call("runs.node.rerun", { runId: sub.id, instructions: "x" }, owner).catch((e) => e)),
    "not_a_helper",
  );
  const w = await h.call("runs.node.rerun", { runId: n.id, instructions: "other" }, watcher).catch((e) => e);
  assert.ok(["permission.not_found", "permission.role_lacks_permission"].includes(codeOf(w) ?? ""));
  const wc = await h.call("runs.node.compare", { runId: n.id }, watcher).catch((e) => e);
  assert.equal(codeOf(wc), "permission.not_found");
  assert.equal(seen.started.length, 0, "nothing was started");
});
