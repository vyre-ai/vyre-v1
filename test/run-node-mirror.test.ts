// The engine's turns in the Run tree (r42-runtime slice 1b): one node per turn, a helper's turn under the turn that started it, a lost turn closed, and a failing call never held up or thrown.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../modules/runs/fixtures/db.ts";
import type { Harness } from "../modules/runs/fixtures/db.ts";
import { createNodeMirror } from "../modules/engine/node-mirror.ts";

const host = { id: "svc_host", kind: "service" as const };
const ALICE = "usr_alice";
const CHAT = `thr_${"a".repeat(32)}`;
const HELP = `thr_${"b".repeat(32)}`;
const turn = (id: string, threadId: string, over: Record<string, unknown> = {}) => ({
  id,
  threadId,
  agentId: `agt_${"c".repeat(32)}`,
  asker: ALICE,
  model: "claude-sonnet-5-5",
  tokensIn: 1200,
  tokensOut: 300,
  ...over,
});
function world(opts: { broken?: boolean; tools?: { allowed: string[]; denied: string[] } } = {}) {
  const h: Harness = harness();
  const logs: string[] = [];
  let threadCalls = 0;
  const mirror = createNodeMirror({
    call: async (cap, input) => {
      if (cap === "threads.get") {
        threadCalls++;
        const id = (input as { threadId: string }).threadId;
        return {
          thread:
            id === HELP
              ? { kind: "helper", title: "Supplier review", parentThreadId: CHAT, starter: ALICE }
              : { kind: "chat", starter: ALICE },
        };
      }
      if (cap === "agents.get") {
        if (!opts.tools) throw new Error("not readable");
        return { agent: { toolsAllowed: opts.tools.allowed, toolsDenied: opts.tools.denied } };
      }
      if (opts.broken) throw new Error("the runs module is away");
      if (cap === "runs.node.start") h.advance(1); // nodes started in one millisecond would sort by random id
      return h.call(cap, input, host);
    },
    nameOf: async () => "Dex",
    log: (m) => logs.push(m),
  });
  const rows = () =>
    h.sqlite
      .prepare(
        "SELECT run_id, root_run, parent_run, kind, status, owner, thread_id, name, spent_json FROM runs_node ORDER BY started_at, run_id",
      )
      .all() as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { h, mirror, logs, rows, threadCalls: () => threadCalls };
}

test("a turn is one node: running at its start, done with its tokens at its end", async () => {
  const w = world();
  const t = turn("trn_1", CHAT);
  await w.mirror.turn(t, "started");
  assert.deepEqual(
    w.rows().map((r) => [r.kind, r.status, r.owner, r.thread_id]),
    [["turn", "running", ALICE, CHAT]],
  );
  await w.mirror.turn(t, "completed");
  const r = w.rows()[0]!;
  assert.equal(r.status, "succeeded");
  assert.deepEqual(JSON.parse(r.spent_json), { tokensIn: 1200, tokensOut: 300, cacheRead: 0, usdMicros: 0, calls: 1 });
});

test("a helper's turn is a helper node under the turn of the chat that started it, with the thread's title", async () => {
  const w = world();
  await w.mirror.turn(turn("trn_p", CHAT), "started");
  await w.mirror.turn(turn("trn_h1", HELP), "started");
  await w.mirror.turn(turn("trn_h2", HELP, { agentId: `agt_${"d".repeat(32)}` }), "started");
  const [parent, a, b] = w.rows();
  assert.equal(a!.kind, "helper");
  assert.equal(a!.name, "Supplier review");
  assert.equal(a!.parent_run, parent!.run_id);
  assert.equal(b!.parent_run, parent!.run_id);
  assert.equal(a!.root_run, parent!.run_id);
  await w.mirror.turn(turn("trn_h1", HELP), "completed");
  await w.mirror.turn(turn("trn_h2", HELP), "failed", { code: "no_column", message: "Numbers had no column" });
  assert.deepEqual(
    w.rows().map((r) => r.status),
    ["running", "succeeded", "failed"],
  );
  const tree = await w.h.call("runs.tree.get", { runId: parent!.run_id }, { id: ALICE, kind: "person", depth: 0 });
  assert.equal(tree.nodes.length, 3);
  assert.equal(tree.nodes.find((n: any) => n.kind === "helper" && n.status === "failed").errorCode, "no_column"); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("a helper with no live turn above it is its own root; the thread is asked about once however many turns it has", async () => {
  const w = world();
  await w.mirror.turn(turn("trn_h", HELP), "started");
  assert.equal(w.rows()[0]!.parent_run, null);
  await w.mirror.turn(turn("trn_h", HELP), "completed");
  await w.mirror.turn(turn("trn_h3", HELP), "started");
  assert.equal(w.threadCalls(), 1);
});

test("the same phase twice, and a phase that arrives before its start, leave one node in the right state", async () => {
  const w = world();
  const t = turn("trn_2", CHAT);
  await w.mirror.turn(t, "completed"); // the started line was lost
  await w.mirror.turn(t, "completed");
  await w.mirror.turn(t, "started"); // a late duplicate
  assert.equal(w.rows().length, 1);
  assert.equal(w.rows()[0]!.status, "succeeded");
  const events = w.h.sqlite.prepare("SELECT type, COUNT(*) AS n FROM runs_event GROUP BY type").all() as Array<{
    type: string;
    n: number;
  }>;
  assert.deepEqual(
    Object.fromEntries(events.map((e) => [e.type, e.n])),
    { state: 2, usage: 1 },
    "one start, one end, one usage line",
  );
});

test("a turn parked on an approval waits, and its end (the wake starts a turn of its own) finishes it", async () => {
  const w = world();
  const t = turn("trn_3", CHAT);
  await w.mirror.turn(t, "started");
  await w.mirror.turn(t, "waiting");
  assert.equal(w.rows()[0]!.status, "waiting");
  await w.mirror.turn(t, "completed");
  assert.equal(w.rows()[0]!.status, "succeeded");
});

test("a stopped turn is stopped with its reason; a turn the server lost is failed, though the engine no longer has its row", async () => {
  const w = world();
  const a = turn("trn_4", CHAT);
  await w.mirror.turn(a, "started");
  await w.mirror.turn(a, "cancelled", { reason: "stop" });
  const b = turn("trn_5", CHAT);
  await w.mirror.turn(b, "started");
  // after the restart the engine knows only these
  await w.mirror.turn({ id: "trn_5", threadId: CHAT, agentId: b.agentId }, "failed", {
    code: "host_lost",
    message: "The server stopped while this turn was working.",
  });
  const rows = w.h.sqlite
    .prepare("SELECT status, stop_reason, error_code FROM runs_node ORDER BY started_at, run_id")
    .all() as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(
    rows.map((r) => [r.status, r.stop_reason, r.error_code]),
    [
      ["stopped", "stop", null],
      ["failed", null, "host_lost"],
    ],
  );
});

test("a call that fails is logged and never thrown, and the next phase repairs the node", async () => {
  const w = world({ broken: true });
  await w.mirror.turn(turn("trn_6", CHAT), "started");
  assert.equal(w.logs.length, 1);
  assert.equal(w.rows().length, 0);
});

test("phases of one turn run in order even when they are sent without waiting", async () => {
  const w = world();
  const t = turn("trn_7", CHAT);
  void w.mirror.turn(t, "started");
  void w.mirror.turn(t, "waiting");
  await w.mirror.turn(t, "completed");
  assert.equal(w.rows()[0]!.status, "succeeded");
  const why = (
    w.h.sqlite.prepare("SELECT payload_json FROM runs_event WHERE type = 'state' ORDER BY seq").all() as Array<{
      payload_json: string;
    }>
  ).map((e) => JSON.parse(e.payload_json).to);
  assert.deepEqual(why, ["running", "waiting", "succeeded"]);
});

test("a turn parked on an approval says what it asks, in words, with the task as the request; the row carries the agent's name", async () => {
  const w = world();
  const t = turn("trn_9", CHAT);
  await w.mirror.turn(t, "started");
  await w.mirror.turn(t, "waiting", { taskId: "tsk_7", tool: "mail_send" });
  const n = w.h.sqlite.prepare("SELECT status, need_json, who_name FROM runs_node").get() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(n.status, "waiting");
  assert.deepEqual(JSON.parse(n.need_json), {
    requestId: "tsk_7",
    what: "Mail send",
    why: "It needs your yes before it goes ahead.",
  });
  assert.equal(n.who_name, "Dex");
  await w.mirror.turn(t, "completed");
  assert.equal(
    (w.h.sqlite.prepare("SELECT need_json FROM runs_node").get() as { need_json: string | null }).need_json,
    null,
  );
});

test("the node is told whose money the turn spends, once: the Space's when its account is shared, the person's own otherwise", async () => {
  for (const [shared, want] of [
    [true, "space"],
    [false, "own"],
  ] as const) {
    const w = world();
    const t = turn("trn_acct", CHAT, {
      info: { account: { ref: "#A", driver: "api", provider: "anthropic", kind: "api_key", shared } },
    });
    await w.mirror.turn(t, "started");
    await w.mirror.usage(t as never);
    await w.mirror.usage({ ...t, tokensIn: 1500 } as never);
    assert.equal(
      (w.h.sqlite.prepare("SELECT spend_scope FROM runs_node").get() as { spend_scope: string }).spend_scope,
      want,
    );
    assert.equal(
      (w.h.sqlite.prepare("SELECT COUNT(*) AS n FROM runs_event WHERE type = 'account'").get() as { n: number }).n,
      1,
    );
  }
});

test("a helper node records the tools its agent was limited to when it began; a chat turn and a helper whose agent has no limits record none", async () => {
  const limited = world({ tools: { allowed: ["web_search"], denied: ["mail_send"] } });
  await limited.mirror.turn(turn("trn_1", HELP), "started");
  await limited.mirror.turn(turn("trn_2", CHAT), "started");
  const policy = (w: ReturnType<typeof world>, kind: string) =>
    (w.h.sqlite.prepare("SELECT policy_json FROM runs_node WHERE kind = ?").get(kind) as { policy_json: string | null })
      .policy_json;
  assert.deepEqual(JSON.parse(policy(limited, "helper")!), {
    tools: { allowed: ["web_search"], denied: ["mail_send"] },
  });
  assert.equal(policy(limited, "turn"), null, "a chat turn has no helper limits");
  const free = world({ tools: { allowed: [], denied: [] } });
  await free.mirror.turn(turn("trn_3", HELP), "started");
  assert.equal(policy(free, "helper"), null, "no limits, nothing recorded");
  const unreadable = world();
  await unreadable.mirror.turn(turn("trn_4", HELP), "started");
  assert.equal(policy(unreadable, "helper"), null);
  assert.equal(unreadable.rows().length, 1, "and the node is made all the same");
});
