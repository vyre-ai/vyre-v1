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
function rig(
  first: string | undefined = "Price the Calder bid from the 2025 sheet. Quote the page.",
  authorize?: Parameters<typeof harness>[0] extends infer O ? (O extends { authorize?: infer A } ? A : never) : never,
) {
  const seen: Seen = { created: [], started: [] };
  const h = harness({
    authorize: authorize ?? ((who, action) => who.id === alice.id || (who.id === bob.id && action.level === "view")),
  });
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
  assert.ok(c.sides[1].runId, "its node stands from the start");
  assert.equal(c.sides[1].brief.instructions, "Use the 2026 sheet. Quote the page.");

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
        adoptKey: `helper:${AGAIN}`,
        idemKey: "turn:t9",
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
  assert.equal(c.sides[1].runId, second.id, "its first turn took the node over");
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
  assert.ok(["permission.not_found", "permission.role_lacks_permission"].includes(codeOf(wc) ?? ""));
  assert.equal(seen.started.length, 0, "nothing was started");
});

test("a re-run carries the first one's tool and approval policy and takes no tool input, so it has what the first had and no more; the same press twice starts one", async () => {
  const { h, seen } = rig();
  const policy = { tools: { allowed: ["web_search"], denied: ["mail_send"] }, onLost: "fail" };
  const { n } = await helper(h, { brief: { goal: "g", instructions: "Use the 2025 sheet." }, policy });
  const out = await h.call("runs.node.rerun", { runId: n.id, instructions: "Use the 2026 sheet." }, owner);
  const row = h.sqlite.prepare("SELECT policy_json, origin_json FROM runs_node WHERE thread_id = ?").get(AGAIN) as {
    policy_json: string;
    origin_json: string;
  };
  assert.deepEqual(JSON.parse(row.policy_json), policy, "the same policy, not wider");
  assert.deepEqual(JSON.parse(row.origin_json), { rerunOf: n.id });
  assert.equal(seen.started[0]!["agentId"], AGENT, "the same agent");
  assert.ok(!("tools" in seen.started[0]!), "no tool input of its own");
  // a tool input on the call is not read: it never reaches the new helper
  await h.call("runs.node.rerun", { runId: n.id, instructions: "Other.", tools: { allowed: ["everything"] } }, owner);
  assert.equal(seen.started.length, 2);
  assert.ok(!JSON.stringify(seen.started[1]).includes("everything"), "no tool the person named is passed on");
  const again = await h.call("runs.node.rerun", { runId: n.id, instructions: "Use the 2026 sheet." }, owner);
  assert.equal(again.threadId, out.threadId, "the same press again is the one already started");
  assert.equal(seen.started.length, 2, "nothing was started twice");
  assert.equal(
    (await h.call("runs.node.compare", { runId: n.id }, owner)).sides.length,
    3,
    "the first and the two different ones",
  );
});

test("save as agent: a second press is the same save (the work's own key), what the person edited is told to the agent, only the asker's own agent is made, and an agents.create refusal makes nothing", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, {
    brief: { goal: "Price the Calder bid", instructions: "Use the 2025 sheet." },
    policy: { tools: { allowed: ["web_search"], denied: [] } },
  });
  await h.call(
    "runs.node.save_as_agent",
    { runId: n.id, name: "Pricer", instructions: "Use the 2026 sheet.", sharing: "everyone" },
    owner,
  );
  await h.call(
    "runs.node.save_as_agent",
    { runId: n.id, name: "Pricer", instructions: "Use the 2026 sheet.", sharing: "everyone" },
    owner,
  );
  await h.call("runs.node.save_as_agent", { runId: n.id, name: "Pricer", sharing: "everyone" }, owner);
  assert.match(String(seen.created[0]!["idempotencyKey"]), new RegExp(`^save:${n.id}:\\d+$`));
  assert.equal(
    seen.created[1]!["idempotencyKey"],
    seen.created[0]!["idempotencyKey"],
    "the same press again: the agents module answers with the one it made",
  );
  assert.notEqual(seen.created[2]!["idempotencyKey"], seen.created[0]!["idempotencyKey"], "other words, another agent");
  assert.equal(seen.created[0]!["instructions"], "Use the 2026 sheet.", "the edit, not the brief");
  assert.match(String(seen.created[2]!["instructions"]), /2025 sheet/, "the brief when nothing was edited");
  assert.equal(seen.created[0]!["sharing"], "everyone");
  assert.ok(!("ownerId" in seen.created[0]!), "owned by whoever asks: it never has more than they do");

  const refusing = rig();
  refusing.h.callee("agents.create", () => {
    throw Object.assign(new Error("no"), { code: "permission.role_lacks_permission" });
  });
  const f = await helper(refusing.h, { brief: { goal: "g", instructions: "x" } });
  for (const sharing of ["me", "everyone"]) {
    const r = await refusing.h
      .call("runs.node.save_as_agent", { runId: f.n.id, name: "Pricer", sharing }, owner)
      .catch((e) => e);
    assert.ok(r instanceof Error, `refused with sharing ${sharing}: no agent was made`);
  }
  assert.equal(refusing.seen.created.length, 0);
});

test("compare is for the owner or a manager of runs: a chat member who may only view the run is refused; runs.node.get says what the caller may do", async () => {
  const { h } = rig();
  const { n } = await helper(h, { brief: { goal: "g", instructions: "x" } });
  const viewer = await h.call("runs.node.compare", { runId: n.id }, watcher).catch((e) => e);
  assert.ok(viewer instanceof Error, "refused");
  assert.equal((await h.call("runs.node.get", { runId: n.id }, owner)).node.can.manage, true);
  const seen = await h.call("runs.node.get", { runId: n.id }, watcher);
  assert.equal(seen.node.can.manage, false, "a viewer sees the node and is told they cannot press");
  assert.ok((await h.call("runs.node.compare", { runId: n.id }, owner)).sides.length >= 1);
});

test("save as agent carries the helper's tool limits only for someone who manages the agent it ran as: a manager of runs with fewer rights gets the default tools, never a wider one; what it was denied is always carried", async () => {
  const policy = { tools: { allowed: ["web_search", "terminal_run"], denied: ["mail_send"] } };
  const made = async (who: typeof owner) => {
    const { h, seen } = rig(undefined, (w, action, res) =>
      w.id === alice.id ? true : w.id === bob.id && res.type !== "agent" && action.level !== "use",
    );
    const { n } = await helper(h, { brief: { goal: "g", instructions: "x" }, policy });
    const out = await h.call("runs.node.save_as_agent", { runId: n.id, name: "Pricer" }, who);
    return { out, made: seen.created[0]! };
  };
  const full = await made(owner);
  assert.deepEqual(full.made["tools"], { allowed: ["web_search", "terminal_run"], denied: ["mail_send"] });
  assert.equal(full.out.toolsCarried, "kept");
  const fewer = await made(watcher);
  assert.deepEqual(fewer.made["tools"], { allowed: [], denied: ["mail_send"] }, "the wider tools are not granted");
  assert.equal(fewer.out.toolsCarried, "narrowed");
  const none = rig();
  const bare = await helper(none.h, { brief: { goal: "g", instructions: "x" } });
  const plain = await none.h.call("runs.node.save_as_agent", { runId: bare.n.id, name: "Pricer" }, owner);
  assert.equal(plain.toolsCarried, "default");
  assert.ok(!("tools" in none.seen.created[0]!), "no limits recorded: the default tools");
});

test("two briefs that differ by one character start two re-runs; the same brief twice starts one", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, { brief: { goal: "g", instructions: "Use the 2025 sheet." } });
  await h.call("runs.node.rerun", { runId: n.id, instructions: "Use the 2026 sheet." }, owner);
  await h.call("runs.node.rerun", { runId: n.id, instructions: "Use the 2026 sheet!" }, owner);
  assert.equal(seen.started.length, 2, "one character apart is a different brief");
  assert.notEqual(seen.started[0]!["idempotencyKey"], seen.started[1]!["idempotencyKey"]);
  await h.call("runs.node.rerun", { runId: n.id, instructions: "Use the 2026 sheet!" }, owner);
  assert.equal(seen.started.length, 2, "the same again is the one already started");
  await h.call(
    "runs.node.rerun",
    { runId: n.id, instructions: "Use the 2026 sheet.", model: "claude-sonnet-5-5" },
    owner,
  );
  assert.equal(seen.started.length, 3, "the same words on another model are another re-run");
});

test("a re-run of a failed helper brings back the helpers that failed only because of it", async () => {
  const { h } = rig();
  h.advance(1);
  const root = (
    await h.call("runs.node.start", { kind: "turn", owner: alice.id, threadId: PARENT, running: true }, engine)
  ).node as { id: string };
  const first = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        parentRun: root.id,
        threadId: HELPER,
        running: true,
        name: "Gamma",
        brief: { goal: "g", instructions: "one" },
      },
      engine,
    )
  ).node as { id: string };
  await h.call(
    "runs.node.move",
    { ...hold(h, first.id), runId: first.id, to: "failed", why: "failed", error: { code: "x", message: "no" } },
    engine,
  );
  const later = (
    await h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: alice.id,
        parentThread: PARENT,
        threadId: `thr_${"e".repeat(32)}`,
        name: "Delta",
        dependsOnThreads: [HELPER],
      },
      engine,
    )
  ).node as { id: string };
  assert.equal((await h.call("runs.node.get", { runId: later.id }, owner)).node.status, "failed");
  await h.call("runs.node.rerun", { runId: first.id, instructions: "two" }, owner);
  const d = (await h.call("runs.node.get", { runId: later.id }, owner)).node;
  assert.equal(d.status, "queued", "Delta waits again, on the re-run");
  const again = (await h.call("runs.node.compare", { runId: first.id }, owner)).sides[1];
  assert.deepEqual(d.dependsOn, [again.runId]);
});

test("two re-runs at once both stay recorded, and two of the same brief are one; numbers in the keys are never used twice, even after the list is cut", async () => {
  const { h, seen } = rig();
  let n = 0;
  const threads = new Map<string, string>();
  h.callee("chat.helper.start", (i: Record<string, unknown>) => {
    seen.started.push(i);
    const key = String(i["idempotencyKey"]);
    if (!threads.has(key)) threads.set(key, `thr_${String(++n).padStart(32, "0")}`);
    return { helper: { threadId: threads.get(key) }, blockId: "blk_1" };
  });
  const { n: first } = await helper(h, { brief: { goal: "g", instructions: "base" } });
  await Promise.all([
    h.call("runs.node.rerun", { runId: first.id, instructions: "alpha" }, owner),
    h.call("runs.node.rerun", { runId: first.id, instructions: "beta" }, owner),
    h.call("runs.node.rerun", { runId: first.id, instructions: "beta" }, owner),
  ]);
  const sides = (await h.call("runs.node.compare", { runId: first.id }, owner)).sides;
  assert.equal(sides.length, 3, "the original and two different re-runs: none was lost");
  assert.equal(new Set(seen.started.map((s) => s["idempotencyKey"])).size, 2, "the same brief twice is one key");
  for (let k = 0; k < 24; k++) await h.call("runs.node.rerun", { runId: first.id, instructions: `more ${k}` }, owner);
  const keys = seen.started.map((s) => String(s["idempotencyKey"]));
  assert.equal(
    new Set(keys).size,
    26,
    "26 different briefs, 26 keys: none was made twice, none reused for another brief",
  );
});

test("saving as an agent: the same words twice is one save, other words are another, at once or not; the key never repeats", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, { brief: { goal: "g", instructions: "base" } });
  await Promise.all([
    h.call("runs.node.save_as_agent", { runId: n.id, name: "A", instructions: "one" }, owner),
    h.call("runs.node.save_as_agent", { runId: n.id, name: "A", instructions: "one" }, owner),
    h.call("runs.node.save_as_agent", { runId: n.id, name: "A", instructions: "two" }, owner),
  ]);
  const keys = seen.created.map((c) => String(c["idempotencyKey"]));
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1], "the same words: the same key, so one agent");
  assert.notEqual(keys[0], keys[2], "other words: another agent");
});

test("a node whose limits were unknown when it began is not saved as an unrestricted agent: the limits are read again as the person, and it is refused when they still cannot be", async () => {
  const { h, seen } = rig();
  const { n } = await helper(h, {
    brief: { goal: "Price the Calder bid", instructions: "Use the 2025 sheet." },
    policy: { toolsUnknown: true },
  });
  h.callee("agents.get", () => {
    throw Object.assign(new Error("That agent is private."), { code: "validation.not_found" });
  });
  const refused = await h.call("runs.node.save_as_agent", { runId: n.id, name: "Pricer" }, owner).catch((e) => e);
  assert.equal(reasonOf(refused), "limits_unknown");
  assert.equal(seen.created.length, 0, "no agent was made");
  const again = await h.call("runs.node.rerun", { runId: n.id, goal: "Price it again" }, owner).catch((e) => e);
  assert.equal(reasonOf(again), "limits_unknown");
  assert.equal(seen.started.length, 0, "nothing was started");

  h.callee("agents.get", () => ({ agent: { toolsAllowed: ["web_search"], toolsDenied: ["mail_send"] } }));
  await h.call("runs.node.save_as_agent", { runId: n.id, name: "Pricer" }, owner);
  assert.deepEqual(seen.created[0]!["tools"], { allowed: ["web_search"], denied: ["mail_send"] });
});
