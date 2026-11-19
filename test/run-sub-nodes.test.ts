// The subagents of a command-line engine as nodes of the Run tree (r42-runtime slice 5): one node per Agent call under the turn that made it, nested ones under their parent, words and use kept on the node, the answer as
// its summary, the same stream twice or a restart in the middle changing nothing, and a failing call never reaching the turn.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../modules/runs/fixtures/db.ts";
import { createSubNodes, iconOf } from "../modules/engine/sub-nodes.ts";

const host = { id: "svc_host", kind: "service" as const };
const THREAD = `thr_${"a".repeat(32)}`;
const base = { threadId: THREAD, turnId: "trn_1", agentId: `agt_${"b".repeat(32)}`, asker: "usr_alice" } as const;
async function world(opts: { broken?: boolean } = {}) {
  const h = harness();
  const logs: string[] = [];
  const mk = () =>
    createSubNodes({
      call: async (cap, input) => {
        if (opts.broken) throw new Error("away");
        if (cap === "runs.node.start") h.advance(1);
        return h.call(cap, input, host);
      },
      log: (m) => logs.push(m),
    });
  // the turn's own node, which a subagent hangs under
  const turn = (
    await h.call("runs.node.start", { kind: "turn", owner: "usr_alice", threadId: THREAD, running: true }, host)
  ).node;
  const rows = () =>
    h.sqlite
      .prepare(
        "SELECT run_id, parent_run, root_run, kind, name, status, summary, spent_json FROM runs_node WHERE kind = 'subagent' ORDER BY started_at, run_id",
      )
      .all() as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { h, mk, logs, turn, rows };
}
const call = (id: string, parent?: string) => ({
  kind: "step" as const,
  phase: "call" as const,
  id,
  name: "Agent",
  ...(parent ? { parent } : {}),
  ...base,
});

test("an Agent call is a node under the turn at once; its task line names it; its words and use are kept; its result ends it with the answer", async () => {
  const w = await world();
  const f = w.mk();
  await f.feed(call("toolu_a"));
  assert.deepEqual(
    w.rows().map((r) => [r.kind, r.status, r.parent_run]),
    [["subagent", "running", w.turn.id]],
  );
  await f.feed({
    kind: "step",
    phase: "input",
    id: "toolu_a",
    detail: "Compare the supplier bids",
    title: true,
    ...base,
  });
  await f.feed({ kind: "sub", id: "m1", parent: "toolu_a", said: "Pine is 3,820", ...base });
  await f.feed({
    kind: "sub",
    id: "m1",
    parent: "toolu_a",
    usage: { inputTokens: 900, outputTokens: 90, cacheReadTokens: 600, model: "claude-x" },
    ...base,
  });
  await f.feed({
    kind: "step",
    phase: "result",
    id: "toolu_a",
    ok: true,
    result: "Calder is 12 percent cheaper",
    ...base,
  });
  const r = w.rows()[0]!;
  assert.equal(r.name, "Compare the supplier bids");
  assert.equal(r.status, "succeeded");
  assert.equal(r.summary, "Calder is 12 percent cheaper");
  assert.deepEqual(JSON.parse(r.spent_json), { tokensIn: 900, tokensOut: 90, cacheRead: 600, usdMicros: 0, calls: 1 });
  const ev = w.h.sqlite
    .prepare("SELECT type, payload_json FROM runs_event WHERE run_id = ? AND type IN ('said','usage')")
    .all(r.run_id) as Array<{ type: string; payload_json: string }>;
  assert.deepEqual(
    ev.map((e) => e.type),
    ["said", "usage"],
  );
  assert.equal(JSON.parse(ev[0]!.payload_json).text, "Pine is 3,820");
});

test("a subagent started by a subagent is a node under it; the same stream again, or after a restart, changes nothing", async () => {
  const w = await world();
  let f = w.mk();
  await f.feed(call("toolu_a"));
  await f.feed(call("toolu_b", "toolu_a"));
  await f.feed({ kind: "sub", id: "m2", parent: "toolu_b", said: "inner says", ...base });
  f = w.mk(); // the server restarted: nothing is remembered in memory
  await f.feed(call("toolu_a"));
  await f.feed(call("toolu_b", "toolu_a"));
  await f.feed({ kind: "sub", id: "m2", parent: "toolu_b", said: "inner says", ...base });
  const rows = w.rows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.parent_run, rows[0]!.run_id, "the inner one hangs under the outer");
  assert.equal(rows[1]!.root_run, w.turn.id);
  const said = w.h.sqlite.prepare("SELECT COUNT(*) AS n FROM runs_event WHERE type = 'said'").get() as { n: number };
  assert.equal(said.n, 1, "one record of what it said");
});

test("a failed subagent ends failed with the reason; a result that only says the work started is not an end; other tools are not subagents", async () => {
  const w = await world();
  const f = w.mk();
  await f.feed(call("toolu_a"));
  await f.feed({ kind: "step", phase: "result", id: "toolu_a", ok: true, ...base });
  assert.equal(w.rows()[0]!.status, "running", "launched in the background: not over");
  await f.feed({
    kind: "step",
    phase: "result",
    id: "toolu_a",
    ok: false,
    result: "It could not open the sheet",
    ...base,
  });
  assert.equal(w.rows()[0]!.status, "failed");
  await f.feed({ kind: "step", phase: "call", id: "tu_9", name: "Bash", ...base });
  assert.equal(w.rows().length, 1);
});

test("a call that fails is logged and never thrown, and a stream with no person behind it makes no node", async () => {
  const bad = await world({ broken: true });
  await bad.mk().feed(call("toolu_a"));
  assert.equal(bad.logs.length, 1);
  const w = await world();
  await w.mk().feed({ ...call("toolu_a"), asker: "" });
  assert.equal(w.rows().length, 0);
});

test("the step of the turn and of a subagent is one plain line with an icon, a touched file in it; a subagent's tool goes to the subagent, the turn's own to the turn", async () => {
  const w = await world();
  const f = createSubNodes({
    call: async (cap, input) => {
      if (cap === "runs.node.start") w.h.advance(1);
      return w.h.call(cap, input, host);
    },
    nodeFor: (turnId) => (turnId === "trn_1" ? w.turn.id : undefined),
    nameOf: async () => "Calder",
  });
  await f.feed({ kind: "step", phase: "call", id: "t1", name: "Read", ...base });
  await f.feed({ kind: "step", phase: "input", id: "t1", detail: "prices.xlsx", ...base });
  await f.feed(call("toolu_a"));
  await f.feed({ kind: "step", phase: "call", id: "t2", name: "WebSearch", parent: "toolu_a", ...base });
  const step = (id: string) =>
    JSON.parse(
      String(
        (w.h.sqlite.prepare("SELECT step_json FROM runs_node WHERE run_id = ?").get(id) as { step_json: string })
          .step_json,
      ),
    );
  assert.deepEqual(step(w.turn.id), { icon: "read", text: "Reading prices.xlsx" });
  const sub = w.rows()[0]!;
  assert.deepEqual(step(sub.run_id), { icon: "web", text: "Searching the web" });
  assert.equal(
    (w.h.sqlite.prepare("SELECT who_name FROM runs_node WHERE run_id = ?").get(sub.run_id) as { who_name: string })
      .who_name,
    "Calder",
  );
});

test("icons by family of tool", () => {
  assert.deepEqual(
    ["Read", "WebFetch", "Bash", "Edit", "Agent", "tool_search", "calendar_create", "mail_send", "records_query"].map(
      iconOf,
    ),
    ["read", "web", "term", "edit", "kid", "find", "cal", "send", "think"],
  );
});

test("a subagent is known by the task id its hooks call agent_id: a stop asked of it refuses its next call, a note told it rides back once, framed, signed with the real name", async () => {
  const w = await world();
  const f = w.mk();
  await f.feed(call("toolu_a"));
  await f.feed(call("toolu_b"));
  const [a, b] = w.rows().map((r) => r.run_id as string);
  f.bindTask(THREAD, "ae63a0c7cf1d188f5", "toolu_a");
  f.bindTask(THREAD, "a3a1aa893f5f8d8fc", "toolu_b");
  assert.deepEqual(await f.gate({ threadId: THREAD, subagent: "ae63a0c7cf1d188f5" }), { block: null, notes: [] });
  // another node of the job tells the first subagent something
  const from = (
    await w.h.call(
      "runs.node.start",
      {
        kind: "helper",
        owner: "usr_alice",
        parentRun: w.turn.id,
        whoKind: "agent",
        whoId: base.agentId,
        whoName: "Calder",
      },
      host,
    )
  ).node;
  await w.h.call("runs.message.send", { runId: from.id, to: a, body: "Pine's price changed to 3,820" }, host);
  const told = await f.gate({ threadId: THREAD, subagent: "ae63a0c7cf1d188f5" });
  assert.equal(told.notes.length, 1);
  assert.match(told.notes[0]!, /^Calder sent you a note\. Only lines that carry the code [0-9a-f]{16}/);
  assert.match(told.notes[0]!, /Pine's price changed to 3,820/);
  assert.equal((await f.gate({ threadId: THREAD, subagent: "ae63a0c7cf1d188f5" })).notes.length, 0, "once");
  // a stop asked of the second one touches that one only
  assert.equal(f.requestStop(b!, "Rubab asked it to stop"), true);
  assert.match(
    String((await f.gate({ threadId: THREAD, subagent: "a3a1aa893f5f8d8fc" })).block),
    /^Stopped: Rubab asked it to stop/,
  );
  assert.equal((await f.gate({ threadId: THREAD, subagent: "ae63a0c7cf1d188f5" })).block, null);
  // unknown ids, another chat, and a node this process never saw
  assert.deepEqual(await f.gate({ threadId: THREAD, subagent: "nobody" }), { block: null, notes: [] });
  assert.deepEqual(await f.gate({ threadId: `thr_${"f".repeat(32)}`, subagent: "a3a1aa893f5f8d8fc" }), {
    block: null,
    notes: [],
  });
  assert.equal(f.requestStop(`run_${"0".repeat(28)}`, "x"), false);
});
