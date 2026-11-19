// The reads behind the run views (lane r42-subagents): the runtime's rows become the shapes the views draw, a server without a read shows nothing and never an error, and "Running and asleep" in the Crew pane asks only
// when opened, opens a run's own chat on a press and says so when it has none.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import { activityRowsOf, boardOf, messagesOf, readActivity, readBoard, readMessages, threadOfRun } from "./reads.ts";
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
