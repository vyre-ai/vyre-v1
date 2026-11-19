// The reads behind the run views (lane r42-subagents): the runtime's rows become the shapes the views draw, a server without a read shows nothing and never an error, and "Running and asleep" in the Crew pane asks only
// when opened, opens a run's own chat on a press and says so when it has none.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import {
  activityRowsOf,
  boardOf,
  findRoot,
  messagesOf,
  nodesOf,
  readActivity,
  readBoard,
  readMessages,
  threadOfRun,
} from "./reads.ts";
import { RunSection } from "./RunSection.tsx";
import { ActivitySection } from "./ActivitySection.tsx";
import { CrewOverview } from "../pane.tsx";

installDom();

const ROWS = {
  rows: [
    {
      runId: "run_a",
      rootRun: "run_a",
      kind: "terminal",
      name: "Build the site",
      whoKind: "agent",
      whoId: "agt_x",
      status: "running",
      startedAt: 1,
      updatedAt: 2,
      usdMicros: 0,
    },
    {
      runId: "run_b",
      rootRun: "run_b",
      kind: "watcher",
      name: "New files in Bids",
      whoKind: "agent",
      status: "waiting",
      wake: { kind: "event", label: "Until a file lands in Bids", wokeCount: 2 },
      startedAt: 1,
      updatedAt: 2,
      usdMicros: 0,
    },
    { runId: "run_c", rootRun: "run_c", kind: "helper", status: "paused", startedAt: 1, updatedAt: 2, usdMicros: 0 },
    { rootRun: "run_d", kind: "helper", status: "running" },
    { runId: "run_e", kind: "helper", status: "odd" },
  ],
};

test("activity rows: a row with no id or an unknown status is dropped, a missing name is Helper, the wake is kept, and nothing at all reads as no rows", () => {
  const r = activityRowsOf(ROWS);
  assert.deepEqual(
    r.map((x) => [x.runId, x.name, x.status]),
    [
      ["run_a", "Build the site", "running"],
      ["run_b", "New files in Bids", "waiting"],
      ["run_c", "Helper", "paused"],
    ],
  );
  assert.deepEqual(r[1]!.wake, { kind: "event", label: "Until a file lands in Bids", wokeCount: 2 });
  assert.deepEqual([activityRowsOf(null), activityRowsOf({}), activityRowsOf({ rows: "x" })], [[], [], []]);
});

test("board and messages: superseded entries are not drawn, an entry without who or text is dropped, answers and Seen are kept", () => {
  const b = boardOf({
    entries: [
      { id: "b1", kind: "fact", text: "Harbor is $4,180", byRun: "run_a", evidence: ["bid.pdf, page 2"], at: 5 },
      {
        id: "b2",
        kind: "question",
        text: "Which rate?",
        byRun: "run_b",
        at: 6,
        answer: { byRun: "run_a", text: "8%", at: 7 },
      },
      { id: "b3", kind: "fact", text: "old", byRun: "run_a", supersededBy: "b1", at: 1 },
      { id: "b4", kind: "fact", text: "", byRun: "run_a", at: 1 },
      { id: "b5", kind: "gossip", text: "x", byRun: "run_a", at: 1 },
    ],
  });
  assert.deepEqual(
    b.map((e) => e.id),
    ["b1", "b2"],
  );
  assert.deepEqual(b[0]!.evidence, ["bid.pdf, page 2"]);
  assert.equal(b[1]!.answer?.text, "8%");
  const m = messagesOf({
    messages: [
      { id: "m1", fromRun: "a", toRun: "b", body: "hi", at: 3, seenAt: 4 },
      { id: "m2", fromRun: "a", body: "no receiver", at: 3 },
    ],
  });
  assert.deepEqual(
    m.map((x) => [x.id, x.seenAt]),
    [["m1", 4]],
  );
});

test("a server without these reads answers nothing, never throws; a run's chat is found through its node", async () => {
  const down = async (): Promise<unknown> => {
    throw new Error("unknown capability");
  };
  assert.equal(await readActivity(down), null);
  assert.equal(await readBoard(down, "run_a"), null);
  assert.equal(await readMessages(down, "run_a"), null);
  assert.equal(await threadOfRun(down, "run_a"), null);
  assert.equal(await threadOfRun(async () => ({ node: { threadId: "thr_h" } }), "run_a"), "thr_h");
  assert.equal(await threadOfRun(async () => ({ node: {} }), "run_a"), null);
});

test("Running and asleep asks nothing until it is opened, groups what it reads, opens a run's chat on a press and says so when it has none", async () => {
  const asked: string[] = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push(cap);
    if (cap === "runs.activity.list") return ROWS;
    if (cap === "runs.node.get")
      return { node: (input as { runId: string }).runId === "run_a" ? { threadId: "thr_a" } : {} };
    return {};
  };
  const root = await mount(createRoot, <ActivitySection call={call} onOpenThread={(t) => opened.push(t)} />);
  assert.deepEqual(asked, [], "nothing is read while it is shut");
  await press(find(root, "crew-activity-toggle"));
  await flush();
  assert.deepEqual(asked, ["runs.activity.list"]);
  assert.match(textOf(find(root, "activity-asleep")), /New files in Bids/);
  assert.ok(find(root, "activity-needs"), "a paused run needs the person");
  await press(find(root, "activity-row-run_a"));
  await flush();
  assert.deepEqual(opened, ["thr_a"]);
  await press(find(root, "activity-row-run_b"));
  await flush();
  assert.match(textOf(find(root, "crew-activity-note")), /no chat to open/);
  await press(find(root, "crew-activity-toggle"));
  assert.equal(find(root, "activity"), null, "shut again");
});

test("a server that cannot list activity shows no section at all in the Crew pane, and one that can shows the button", async () => {
  const status = {
    members: [],
    totals: {
      members: 0,
      working: 0,
      done: 0,
      needsYou: 0,
      failed: 0,
      stopped: 0,
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
      filesChanged: 0,
      added: 0,
      deleted: 0,
      elapsedMs: 0,
    },
  } as never;
  const ok = await mount(
    createRoot,
    <CrewOverview
      status={status}
      call={async () => ({})}
      threadId="thr_0"
      onPeek={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  assert.ok(find(ok, "crew-activity-toggle"));
  const down = async (): Promise<unknown> => {
    throw new Error("unknown capability");
  };
  const root = await mount(createRoot, <ActivitySection call={down} />);
  await press(find(root, "crew-activity-toggle"));
  await flush();
  assert.equal(find(root, "crew-activity"), null, "nothing is drawn when the server cannot say");
});

const TREE = {
  nodes: [
    {
      id: "run_r",
      rootRun: "run_r",
      kind: "subagent",
      name: "Research",
      status: "running",
      spent: { tokensIn: 1000, tokensOut: 100, cacheRead: 400, usdMicros: 5000 },
      startedAt: 1,
    },
    {
      id: "run_n",
      rootRun: "run_r",
      parentRun: "run_r",
      kind: "helper",
      name: "Numbers",
      status: "succeeded",
      summary: "done",
      spent: { tokensIn: 2000, tokensOut: 300, cacheRead: 0, usdMicros: 9000 },
      startedAt: 2,
      endedAt: 9,
    },
    { kind: "helper", status: "running" },
  ],
};

test("the root of a chat's work and its nodes: a tree with no root, an unknown status or a missing id is dropped; a person who only watches is not given the board", async () => {
  assert.deepEqual(
    nodesOf(TREE).map((n) => [n.id, n.name, n.spent.cacheRead]),
    [
      ["run_r", "Research", 400],
      ["run_n", "Numbers", 0],
    ],
  );
  assert.deepEqual(
    await findRoot(async () => ({ roots: [{ rootRun: "run_r", runId: "run_n", full: true }] }), "thr_0"),
    { rootRun: "run_r", runId: "run_n", full: true },
  );
  assert.equal((await findRoot(async () => ({ roots: [{ rootRun: "run_r", full: false }] }), "thr_0"))?.full, false);
  assert.equal(await findRoot(async () => ({ roots: [] }), "thr_0"), null);
  assert.equal(
    await findRoot(async () => {
      throw new Error("no");
    }, "thr_0"),
    null,
  );
});

test("What they know together reads the newest tree of this chat only when opened, shows the board, the last words between helpers and the token report, and shows nothing when the chat has no tree, the server cannot say, or the person only watches", async () => {
  const asked: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push(cap);
    if (cap === "runs.tree.find") return { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] };
    if (cap === "runs.board.list")
      return {
        entries: [{ id: "b1", kind: "fact", text: "Harbor is $4,180", byRun: "run_r", evidence: ["bid.pdf"], at: 5 }],
      };
    if (cap === "runs.message.list")
      return { messages: [{ id: "m1", fromRun: "run_n", toRun: "run_r", body: "Calder is $13,105", at: 6 }] };
    if (cap === "runs.tree.get") return TREE;
    void input;
    return {};
  };
  const root = await mount(createRoot, <RunSection call={call} threadId="thr_0" />);
  assert.deepEqual(asked, [], "nothing is read while it is shut");
  await press(find(root, "crew-run-toggle"));
  await flush();
  assert.deepEqual([...new Set(asked)].sort(), [
    "runs.board.list",
    "runs.message.list",
    "runs.tree.find",
    "runs.tree.get",
  ]);
  assert.match(textOf(find(root, "board-entry-b1")), /Harbor is \$4,180[\s\S]*Research/);
  assert.match(
    textOf(find(root, "message-line-m1"))
      .replace(/\s+/g, " ")
      .replace(/ ([:.,])/g, "$1"),
    /Numbers to Research: Calder is \$13,105/,
  );
  assert.match(textOf(find(root, "token-report-line")), /3,400\s+tokens/);
  const none = await mount(createRoot, <RunSection call={async () => ({ roots: [] })} threadId="thr_0" />);
  await press(find(none, "crew-run-toggle"));
  await flush();
  assert.equal(find(none, "crew-run"), null, "a chat with no tree shows nothing");
  const watch = await mount(
    createRoot,
    <RunSection
      call={async (cap) => (cap === "runs.tree.find" ? { roots: [{ rootRun: "run_r", full: false }] } : {})}
      threadId="thr_0"
    />,
  );
  await press(find(watch, "crew-run-toggle"));
  await flush();
  assert.equal(find(watch, "crew-run"), null, "a person who only watches gets no board");
  const down = await mount(
    createRoot,
    <RunSection
      call={async () => {
        throw new Error("unknown capability");
      }}
      threadId="thr_0"
    />,
  );
  await press(find(down, "crew-run-toggle"));
  await flush();
  assert.equal(find(down, "crew-run"), null, "a server without the reads shows nothing");
});
