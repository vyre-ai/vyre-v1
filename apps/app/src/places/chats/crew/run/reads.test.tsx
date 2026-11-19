// The reads behind the run views (lane r42-subagents): the runtime's rows become the shapes the views draw, a server without a read shows nothing and never an error, and "Running and asleep" in the Crew pane asks only
// when opened, opens a run's own chat on a press and says so when it has none.
import test, { mock } from "node:test";
import { act, useEffect, useState } from "react";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Pressable, Text } from "react-native";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import {
  activityRowsOf,
  boardOf,
  findRoot,
  isAbsent,
  messagesOf,
  nodesOf,
  readActivity,
  readBoard,
  readMessages,
  threadOfRun,
} from "./reads.ts";
import { CrewTabs } from "./CrewTabs.tsx";
import { CrewProvider, useCrew } from "../context.tsx";
import { useShown } from "./useShown.ts";

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
  assert.equal(await readActivity(down), "absent");
  assert.equal(
    await readActivity(async () => {
      throw new Error("network down");
    }),
    "failed",
    "one failed request is not a server without the read",
  );
  assert.equal(await readBoard(down, "run_a"), null);
  assert.equal(await readMessages(down, "run_a"), null);
  assert.equal(await threadOfRun(down, "run_a"), null);
  assert.equal(await threadOfRun(async () => ({ node: { threadId: "thr_h" } }), "run_a"), "thr_h");
  assert.equal(await threadOfRun(async () => ({ node: {} }), "run_a"), null);
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
  const watching = await findRoot(async () => ({ roots: [{ rootRun: "run_r", full: false }] }), "thr_0");
  assert.equal(typeof watching === "object" ? watching.full : null, false);
  assert.equal(await findRoot(async () => ({ roots: [] }), "thr_0"), "none");
  assert.equal(
    await findRoot(async () => {
      throw new Error("unknown capability");
    }, "thr_0"),
    "none",
  );
  assert.equal(
    await findRoot(async () => {
      throw new Error("timeout");
    }, "thr_0"),
    "failed",
  );
});

const HELP = <Text testID="the-helpers">helpers as they were</Text>;
const ROWS_OK = ROWS;
function rig(over: Record<string, (i: unknown) => unknown> = {}) {
  const asked: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push(cap);
    if (over[cap]) return over[cap]!(input);
    if (cap === "runs.activity.list") return ROWS_OK;
    if (cap === "runs.tree.find") return { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] };
    if (cap === "runs.board.list")
      return {
        entries: [{ id: "b1", kind: "fact", text: "Harbor is $4,180", byRun: "run_r", evidence: ["bid.pdf"], at: 5 }],
      };
    if (cap === "runs.message.list")
      return { messages: [{ id: "m1", fromRun: "run_n", toRun: "run_r", body: "Calder is $13,105", at: 6 }] };
    if (cap === "runs.tree.get") return TREE;
    return {};
  };
  return { call, asked };
}

test("the Crew pane is Helpers / Board / Tokens as the shared tab strip when the chat has a tree of work: Helpers keeps the pane and lists what the Space runs or sleeps, Board has the board and the faces-and-words lines, Tokens the quiet line", async () => {
  const { call, asked } = rig();
  const opened: string[] = [];
  const root = await mount(
    createRoot,
    <CrewTabs call={call} threadId="thr_0" helpers={HELP} onOpenThread={(t) => opened.push(t)} />,
  );
  await flush();
  assert.ok(find(root, "the-helpers"), "Helpers is the pane as it was");
  assert.ok(find(root, "activity-asleep"), "with what is running or asleep under it");
  assert.match(textOf(find(root, "crew-tab-tab-board")), /Board\s*1/);
  assert.ok(find(root, "crew-tab-tab-helpers") && find(root, "crew-tab-tab-tokens"));
  assert.equal(find(root, "board"), null, "the board is not on the Helpers tab");
  await press(find(root, "crew-tab-tab-board"));
  assert.match(textOf(find(root, "board-entry-b1")), /Harbor is \$4,180[\s\S]*Research/);
  assert.match(textOf(find(root, "message-line-m1")), /Calder is \$13,105/);
  assert.equal(find(root, "the-helpers"), null);
  await press(find(root, "crew-tab-tab-tokens"));
  assert.match(textOf(find(root, "token-report-line")), /3,400\s+tokens/);
  assert.equal(find(root, "token-report-rows"), null, "details on a press");
  await press(find(root, "token-report-line"));
  assert.ok(find(root, "token-row-run_r"));
  await press(find(root, "crew-tab-tab-helpers"));
  assert.ok(find(root, "the-helpers"));
  assert.ok(asked.includes("runs.tree.find") && asked.includes("runs.activity.list"));
  assert.deepEqual(opened, []);
});

test("a press on a run opens its own chat, says so when it has none, and of two quick presses only the later one opens", async () => {
  const opened: string[] = [];
  const waits: Record<string, (v: unknown) => void> = {};
  const { call } = rig({ "runs.node.get": (i) => new Promise((r) => (waits[(i as { runId: string }).runId] = r)) });
  const root = await mount(
    createRoot,
    <CrewTabs call={call} threadId="thr_0" helpers={HELP} onOpenThread={(t) => opened.push(t)} />,
  );
  await flush();
  await press(find(root, "activity-row-run_a"));
  await press(find(root, "activity-row-run_b"));
  waits["run_b"]!({ node: { threadId: "thr_b" } });
  await flush();
  waits["run_a"]!({ node: { threadId: "thr_a" } });
  await flush();
  assert.deepEqual(opened, ["thr_b"], "the earlier answer that arrives last does not take over");
  await press(find(root, "activity-row-run_c"));
  waits["run_c"]!({ node: {} });
  await flush();
  assert.match(textOf(find(root, "crew-activity-note")), /no chat to open/);
});

test("no tree of work in the chat, a person who only watches, or a server without the reads: no tab strip, the pane is just Helpers; a server without the activity read lists nothing", async () => {
  const none = rig({ "runs.tree.find": () => ({ roots: [] }) });
  const a = await mount(createRoot, <CrewTabs call={none.call} threadId="thr_0" helpers={HELP} />);
  await flush();
  assert.ok(find(a, "the-helpers"));
  assert.equal(find(a, "crew-tab-tab-board"), null);
  const watch = rig({ "runs.tree.find": () => ({ roots: [{ rootRun: "run_r", full: false }] }) });
  const b = await mount(createRoot, <CrewTabs call={watch.call} threadId="thr_0" helpers={HELP} />);
  await flush();
  assert.equal(find(b, "crew-tab-tab-board"), null, "a person who only watches gets no board");
  const down = async (): Promise<unknown> => {
    throw new Error("unknown capability");
  };
  const c = await mount(createRoot, <CrewTabs call={down} threadId="thr_0" helpers={HELP} />);
  await flush();
  assert.ok(find(c, "the-helpers"));
  assert.equal(find(c, "crew-tab-tab-board"), null);
  assert.equal(find(c, "activity"), null);
});

test("a refresh that fails keeps the board and the rows and says so quietly; the next good one clears it", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    let n = 0;
    const { call } = rig({
      "runs.tree.find": () => {
        n++;
        if (n === 2) throw new Error("network down");
        return { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] };
      },
    });
    const root = await mount(createRoot, <CrewTabs call={call} threadId="thr_0" helpers={HELP} />);
    await flush();
    await press(find(root, "crew-tab-tab-board"));
    assert.ok(find(root, "board-entry-b1"));
    await act(async () => mock.timers.tick(5000));
    await flush();
    assert.ok(find(root, "board-entry-b1"), "the board stays");
    assert.match(textOf(find(root, "crew-tabs-stale")), /Could not refresh/);
    await act(async () => mock.timers.tick(5000));
    await flush();
    assert.equal(find(root, "crew-tabs-stale"), null, "and the next good refresh clears it");
  } finally {
    mock.timers.reset();
  }
});

test("the runtime's new row fields: step {icon,text}, need, whoName, stuck and dependsOn are read; a need puts a run under Needs you", () => {
  const rows = activityRowsOf({
    rows: [
      {
        runId: "run_a",
        status: "running",
        name: "Docs",
        step: { icon: "edit", text: "Adding the bids table" },
        whoName: "Docs",
        startedAt: 1,
      },
      {
        runId: "run_b",
        status: "waiting",
        name: "Mail",
        need: { requestId: "tsk_1", what: "Mail send", why: "It would email Harbor." },
        startedAt: 1,
      },
      {
        runId: "run_c",
        status: "running",
        name: "Import",
        stuck: { since: 5, reason: "the same step four times" },
        startedAt: 1,
      },
      { runId: "run_d", status: "running", name: "x", need: { what: "no request id" }, startedAt: 1 },
    ],
  });
  assert.deepEqual([rows[0]!.step, rows[0]!.whoName], ["Adding the bids table", "Docs"]);
  assert.deepEqual(rows[1]!.need, { requestId: "tsk_1", what: "Mail send", why: "It would email Harbor." });
  assert.equal(rows[2]!.stuck?.reason, "the same step four times");
  assert.equal(rows[3]!.need, undefined, "a need with no request is not drawn");
  const n = nodesOf({
    nodes: [
      {
        id: "run_d",
        status: "running",
        name: "Docs",
        dependsOn: ["run_r", 4],
        step: { icon: "edit", text: "Writing" },
        stuck: { since: 1, reason: "x" },
        need: { requestId: "t", what: "w" },
        spent: {},
        startedAt: 1,
      },
    ],
  });
  assert.deepEqual(
    [n[0]!.dependsOn, n[0]!.step, n[0]!.stuck?.reason, n[0]!.need?.what],
    [["run_r"], "Writing", "x", "w"],
  );
});

test("only a server that says it has no such read is absent: a thread or run that is not found is one failed request", () => {
  assert.equal(isAbsent(new Error("unknown capability runs.activity.list")), true);
  assert.equal(isAbsent(new Error("thread not found")), false);
  assert.equal(isAbsent(new Error("not_found")), false);
  assert.equal(isAbsent(new Error("network down")), false);
});

test("another chat shows nothing of the last one's board while it is read", async () => {
  const gate: { open?: (v: unknown) => void } = {};
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const thread = (input as { threadId?: string }).threadId;
    if (cap === "runs.tree.find")
      return thread === "thr_a"
        ? { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] }
        : new Promise((r) => (gate.open = r));
    if (cap === "runs.board.list")
      return { entries: [{ id: "b1", kind: "fact", text: "Harbor is $4,180", byRun: "run_r", at: 5 }] };
    if (cap === "runs.tree.get") return TREE;
    return {};
  };
  const Host = (): ReturnType<typeof CrewTabs> => {
    const [t, setT] = useState("thr_a");
    return (
      <>
        <Pressable testID="switch" onPress={() => setT("thr_b")}>
          {null}
        </Pressable>
        <CrewTabs call={call} threadId={t} helpers={HELP} />
      </>
    ) as never;
  };
  const root = await mount(createRoot, <Host />);
  await flush();
  assert.ok(find(root, "crew-tab-tab-board"), "chat A has a board");
  await press(find(root, "switch"));
  await flush();
  assert.equal(find(root, "crew-tab-tab-board"), null, "chat B shows none of A's while it is read");
});

test("the chat reads the runtime only while it has helpers or its pane is open; a pane given the shared reads reads none of its own", async () => {
  const asked: string[] = [];
  const mk =
    (members: unknown[]) =>
    async (cap: string): Promise<unknown> => {
      asked.push(cap);
      if (cap === "engine.crew.status")
        return {
          members,
          totals: {
            members: members.length,
            working: members.length,
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
        };
      if (cap === "runs.tree.find") return { roots: [] };
      return {};
    };
  const Probe = (): ReturnType<typeof CrewTabs> => null as never;
  void Probe;
  const idle = await mount(
    createRoot,
    <CrewProvider call={mk([]) as never} threadId="thr_0">
      <Text>x</Text>
    </CrewProvider>,
  );
  await flush();
  assert.equal(
    asked.filter((c) => c.startsWith("runs.")).length,
    0,
    "a chat that never had a helper asks the runtime nothing",
  );
  void idle;
  asked.length = 0;
  const member = {
    kind: "helper",
    id: "thr_h",
    parentThreadId: "thr_0",
    title: "T",
    agentId: "a",
    state: "working",
    startedAt: 1,
    elapsedMs: 1,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
  };
  await mount(
    createRoot,
    <CrewProvider call={mk([member]) as never} threadId="thr_0">
      <Text>x</Text>
    </CrewProvider>,
  );
  await flush();
  await flush();
  assert.ok(asked.includes("runs.tree.find"), "a chat with a helper does");
  asked.length = 0;
  const shared = { status: "ready" as const, board: [], messages: [], nodes: [], stale: false };
  await mount(createRoot, <CrewTabs call={mk([]) as never} threadId="thr_0" helpers={HELP} run={shared} />);
  await flush();
  assert.equal(
    asked.filter((c) => c === "runs.tree.find").length,
    0,
    "the pane uses the shared read, not a second one",
  );
});

test("the chat's runtime read pauses while its place is hidden and reads at once when it shows again", async () => {
  const asked: string[] = [];
  const member = {
    kind: "helper",
    id: "thr_h",
    parentThreadId: "thr_0",
    title: "T",
    agentId: "a",
    state: "working",
    startedAt: 1,
    elapsedMs: 1,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
  };
  const call = async (cap: string): Promise<unknown> => {
    asked.push(cap);
    if (cap === "engine.crew.status")
      return {
        members: [member],
        totals: {
          members: 1,
          working: 1,
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
      };
    if (cap === "runs.tree.find") return { roots: [] };
    return {};
  };
  const Host = (): ReturnType<typeof CrewTabs> => {
    const [shown, setShown] = useState(false);
    return (
      <>
        <Pressable testID="show" onPress={() => setShown(true)}>
          {null}
        </Pressable>
        <CrewProvider call={call as never} threadId="thr_0" shown={shown}>
          <Text>x</Text>
        </CrewProvider>
      </>
    ) as never;
  };
  const root = await mount(createRoot, <Host />);
  await flush();
  await flush();
  assert.equal(asked.filter((c) => c.startsWith("runs.")).length, 0, "hidden: nothing is read");
  await press(find(root, "show"));
  await flush();
  assert.ok(asked.includes("runs.tree.find"), "shown: one read at once");
});

test("a place is shown unless the window is hidden or the place has no size; it reads again on a visibility change", async () => {
  const g = globalThis as { document?: unknown };
  const had = g.document;
  const listeners: Array<() => void> = [];
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: string, f: () => void) => void listeners.push(f),
    removeEventListener: () => undefined,
  };
  g.document = doc;
  let size = { width: 100, height: 100 };
  const ref = { current: { getBoundingClientRect: () => size } };
  const Host = (): ReturnType<typeof CrewTabs> =>
    (<Text testID="state">{useShown(ref) ? "shown" : "hidden"}</Text>) as never;
  try {
    const root = await mount(createRoot, <Host />);
    assert.equal(textOf(find(root, "state")), "shown");
    size = { width: 0, height: 0 };
    await act(async () => listeners.forEach((f) => f()));
    assert.equal(textOf(find(root, "state")), "hidden", "kept mounted behind another place: no size");
    size = { width: 100, height: 100 };
    doc.visibilityState = "hidden";
    await act(async () => listeners.forEach((f) => f()));
    assert.equal(textOf(find(root, "state")), "hidden", "a hidden window");
    doc.visibilityState = "visible";
    await act(async () => listeners.forEach((f) => f()));
    assert.equal(textOf(find(root, "state")), "shown");
  } finally {
    g.document = had;
  }
});

test("the Crew pane being on screen, however it opened, turns the runtime read on even for a chat with no helper yet", async () => {
  const asked: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    asked.push(cap);
    if (cap === "engine.crew.status")
      return {
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
      };
    if (cap === "runs.tree.find") return { roots: [] };
    return {};
  };
  const Pane = (): ReturnType<typeof CrewTabs> => {
    const crew = useCrew();
    const reveal = crew?.reveal;
    useEffect(() => {
      reveal?.(true);
      return () => reveal?.(false);
    }, [reveal]);
    return (<Text>pane</Text>) as never;
  };
  const Host = (): ReturnType<typeof CrewTabs> => {
    const [on, setOn] = useState(false);
    return (
      <>
        <Pressable testID="open-pane" onPress={() => setOn((x) => !x)}>
          {null}
        </Pressable>
        <CrewProvider call={call as never} threadId="thr_0">
          {on ? <Pane /> : <Text>none</Text>}
        </CrewProvider>
      </>
    ) as never;
  };
  const root = await mount(createRoot, <Host />);
  await flush();
  assert.equal(asked.filter((c) => c.startsWith("runs.")).length, 0, "no helper and no pane: nothing is read");
  await press(find(root, "open-pane"));
  await flush();
  assert.ok(asked.includes("runs.tree.find"), "the pane is showing: read");
  asked.length = 0;
  await press(find(root, "open-pane"));
  await flush();
  await flush();
  assert.equal(asked.filter((c) => c.startsWith("runs.")).length, 0, "the pane closed: reading stops");
});
