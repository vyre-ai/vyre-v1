// The subagents a command-line engine starts in its own turn (finding F41) as a person meets them: rows in the crew block with no chat behind them, a peek that has no Open chat, Stop or Ask, and the
// helpers that pick which of them a reply carries and which are still on their own on screen. Rendered with the real components.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { CrewBlock } from "../session/CrewBlock.tsx";
import { CrewPeek } from "./pane.tsx";
import { HelperPane } from "../session/HelperPane.tsx";
import { CrewProvider, useCrew } from "./context.tsx";
import { LiveSubagents } from "./live.tsx";
import { createTurnStreams } from "../../../shell/session/turn-streams.ts";
import { liveSubagents, subagentId, subagentIdsOf, totalsOf, withLive } from "./model.ts";
import type { CrewMember, CrewStatusOut } from "./model.ts";

installDom();

const S = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "subagent",
    id: subagentId("toolu_01A"),
    parentThreadId: "thr_0",
    title: "Test the terminal",
    agentId: "agt_dex",
    state: "working",
    step: "Running a command",
    steps: ["Reading page.html", "Running a command"],
    startedAt: 1_000,
    elapsedMs: 4_000,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    ...o,
  }) as CrewMember;

test("the id of a subagent is the engine's call id in letters and digits, and a reply names its subagents by its Agent calls", () => {
  assert.equal(subagentId("toolu_01A-b"), "sub_toolu01Ab");
  const blocks = [
    { type: "tool_call", data: { id: "toolu_a", name: "Agent" } },
    { type: "tool_call", data: { id: "x1", name: "Bash" } },
    { type: "tool_call", data: { id: "toolu_b", name: "Task" } },
    { type: "text", data: {} },
  ];
  assert.deepEqual(subagentIdsOf(blocks), ["sub_toolua", "sub_toolub"]);
});

test("a subagent no reply carries yet is shown on its own; once a reply carries it, it is not", () => {
  const a = S({ id: "sub_a" }),
    b = S({ id: "sub_b", state: "done" }),
    h = { ...S({ id: "thr_h" }), kind: "helper" } as CrewMember;
  const status = { members: [a, b, h], totals: totalsOf([a, b, h]) } as CrewStatusOut;
  assert.deepEqual(
    liveSubagents(status, new Set()).map((m) => m.id),
    ["sub_a", "sub_b"],
  );
  assert.deepEqual(
    liveSubagents(status, new Set(["sub_b"])).map((m) => m.id),
    ["sub_a"],
  );
  assert.deepEqual(liveSubagents(null, new Set()), []);
  assert.deepEqual([totalsOf([a, b]).members, totalsOf([a, b]).working, totalsOf([a, b]).done], [2, 1, 1]);
});

test("a subagent's row reads its steps from the row itself, never from a chat, and opens in the pane", async () => {
  const asked: string[] = [];
  const peeked: string[] = [];
  const rows = [
    S(),
    S({ id: "sub_b", title: "Test the browser", state: "done", found: "The page loaded.", steps: [] }),
  ];
  const root = await mount(
    createRoot,
    <CrewBlock
      members={rows}
      totals={totalsOf(rows)}
      call={async (cap) => {
        asked.push(cap);
        return {};
      }}
      onPeek={(m) => peeked.push(m.id)}
    />,
  );
  assert.equal(textOf(find(root, `crew-chip-${rows[0]!.id}-state`)), "Working");
  assert.equal(textOf(find(root, "crew-chip-sub_b-state")), "Done");
  await press(find(root, `row-crew-chip-${rows[0]!.id}-toggle`));
  await flush();
  const open = textOf(find(root, `crew-chip-${rows[0]!.id}-steps`));
  assert.ok(open.includes("Reading page.html") && open.includes("Running a command"));
  await press(find(root, "row-crew-chip-sub_b-toggle"));
  await flush();
  assert.equal(textOf(find(root, "crew-chip-sub_b-line")), "The page loaded.");
  assert.deepEqual(asked, [], "no chat is read for a subagent");
  await press(find(root, `crew-chip-${rows[0]!.id}-name`));
  assert.deepEqual(peeked, [rows[0]!.id]);
});

test("a subagent's peek: its task, its steps, what it returned in full; no Open chat, Stop, Ask or model", async () => {
  const calls: string[] = [];
  const answer = "The terminal works. I ran echo and saw hello. The second line of the answer.";
  const root = await mount(
    createRoot,
    <CrewPeek
      member={S({ state: "done", step: undefined as never, found: "The terminal works.", answer, endedAt: 9_000 })}
      call={async (cap) => {
        calls.push(cap);
        return {};
      }}
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await flush();
  assert.equal(textOf(find(root, "crew-peek-name")), "Test the terminal");
  assert.equal(find(root, "crew-peek-brief"), null, "the task is the name above it, not said twice");
  assert.equal(textOf(find(root, "crew-peek-answer")), answer);
  assert.ok(find(root, "crew-step-0") && find(root, "crew-step-1"));
  for (const gone of ["crew-peek-open", "crew-peek-stop", "crew-peek-ask", "crew-peek-model"])
    assert.equal(find(root, gone), null, gone);
  assert.deepEqual(calls, [], "nothing is read for a subagent: it has no chat");
  const live = await mount(
    createRoot,
    <CrewPeek
      member={S()}
      call={async () => ({})}
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await flush();
  assert.equal(find(live, "crew-peek-stop"), null, "a subagent stops with its turn");
  assert.equal(find(live, "crew-peek-ask"), null);
});

test("a running turn's subagents come from its live frames: rows with task, state and clock; what each is on only from the asker's own frames; no read and no timer", async () => {
  const streams = createTurnStreams();
  const frame = (delta: Record<string, unknown>) =>
    streams.onFrame({ t: "turn", turn: "trn_1", delta: { threadId: "thr_0", agentId: "agt_dex", ...delta } });
  frame({ kind: "start", asker: "usr_a" });
  // a call whose task line has not come yet is not drawn as an unnamed helper
  frame({ kind: "steps", steps: [{ phase: "call", id: "toolu_0", name: "Agent" }] });
  frame({
    kind: "steps",
    steps: [
      { phase: "call", id: "toolu_a", name: "Agent" },
      { phase: "input", id: "toolu_a", detail: "Test the terminal" },
    ],
  });
  frame({
    kind: "steps",
    steps: [
      { phase: "call", id: "toolu_b", name: "Agent" },
      { phase: "input", id: "toolu_b", detail: "Test the browser" },
    ],
  });
  frame({
    kind: "substeps",
    steps: [
      { phase: "call", id: "tu_1", name: "Bash", parent: "toolu_a" },
      { phase: "call", id: "tu_2", name: "Read", parent: "toolu_b" },
      { phase: "input", id: "tu_2", detail: "page.html", parent: "toolu_b" },
    ],
  });
  const reads: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    reads.push(cap);
    return { members: [], totals: totalsOf([]) };
  };
  let seen: CrewStatusOut | null = null;
  const Probe = (): null => {
    seen = useCrew()?.status ?? null;
    return null;
  };
  const turns = streams.turnsOf("thr_0");
  await mount(
    createRoot,
    <CrewProvider call={call} threadId="thr_0">
      <LiveSubagents turns={turns} activityOf={(id) => streams.activityOf(id)} />
      <Probe />
    </CrewProvider>,
  );
  await flush();
  const members = (seen as CrewStatusOut | null)?.members ?? [];
  assert.equal(members.length, 3, "the call whose task line has not come yet is a row at once");
  assert.equal(members[0]!.title, "Starting");
  members.shift();
  assert.deepEqual(
    members.map((m) => [m.kind, m.title, m.state]),
    [
      ["subagent", "Test the terminal", "working"],
      ["subagent", "Test the browser", "working"],
    ],
  );
  assert.deepEqual(
    members.map((m) => m.step),
    ["Running a command", "Reading page.html"],
  );
  assert.ok(members.every((m) => m.startedAt > 0));
  // the first returns: Done, and the clock stops
  frame({ kind: "steps", steps: [{ phase: "result", id: "toolu_a", name: "Agent", ok: true }] });
  await flush();
  const after = ((seen as CrewStatusOut | null)?.members ?? []).slice(1);
  assert.deepEqual(
    after.map((m) => m.state),
    ["done", "working"],
  );
  assert.equal(after[0]!.step, undefined);
  // one read when the chat opens, none for the subagents, no timer
  const once = reads.length;
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(reads.length, once, "nothing reads again while subagents work");
});

test("a person who is not the asker gets no substeps frame to show: the rows still say Working", () => {
  const live = withLive(null, [S({ step: undefined as never, steps: undefined as never })]);
  assert.equal(live?.members[0]?.step, undefined);
  assert.equal(live?.totals.working, 1);
});

test("a subagent's pane asks for no workspace: it has no chat, and the ask is refused on every open (found by the real-app walk)", async () => {
  const asked: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    asked.push(cap);
    return cap === "engine.crew.workspace" ? { workspace: null } : cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const pane = (m: CrewMember) => (
    <HelperPane
      member={m}
      call={call}
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />
  );
  await mount(createRoot, pane(S()));
  await flush();
  assert.deepEqual(asked, [], "nothing at all is asked for a subagent");
  await mount(createRoot, pane({ ...S({ id: "thr_h" }), kind: "helper" } as CrewMember));
  await flush();
  assert.ok(asked.includes("engine.crew.workspace"), "a helper's pane still asks");
});
