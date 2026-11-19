// The subagents of a command-line engine as nodes of the Run tree (r42-runtime slice 5): one node per Agent call under the turn that made it, nested ones under their parent, words and use kept on the node, the answer as
// its summary, the same stream twice or a restart in the middle changing nothing, and a failing call never reaching the turn.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../modules/runs/fixtures/db.ts";
import { createSubNodes } from "../modules/engine/sub-nodes.ts";

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
