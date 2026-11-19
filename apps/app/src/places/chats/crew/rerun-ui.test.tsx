// Save as agent, Run again and the compare in the helper's pane (lane r42-subagents, r42-runtime slice 7, 19 Nov 2026). Each test fails on the code before it: no buttons, no key against a double press, no words for a refusal.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewPeek } from "./pane.tsx";
import type { CrewMember } from "./model.ts";
import { compareDiff, sideLabel, sideOpen } from "./run/model.ts";
import type { CompareSide } from "./run/model.ts";
import { refusalWords, sidesOf } from "./run/reads.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "helper",
    id: "thr_a",
    runId: "run_a",
    parentThreadId: "thr_0",
    title: "Supplier bids",
    name: "Tess",
    agentId: "agt_tess",
    state: "done",
    found: "Harbor Supply fits best.",
    startedAt: 1_000,
    endedAt: 9_000,
    elapsedMs: 8_000,
    tokensIn: 4_000,
    tokensOut: 900,
    costMicros: 30_000,
    model: "claude-sonnet-5-5",
    ...o,
  }) as CrewMember;

const SIDES: CompareSide[] = [
  {
    runId: "run_a",
    threadId: "thr_a",
    status: "succeeded",
    brief: { instructions: "Compare the three bids." },
    result: "Harbor Supply fits best.",
    usdMicros: 30_000,
    tokens: 4_900,
    seconds: 8,
    model: "claude-sonnet-5-5",
  },
  {
    threadId: "thr_b",
    status: "queued",
    usdMicros: 0,
    tokens: 0,
  },
];

let setupState: { sides: CompareSide[] } = { sides: [] };
const DONE: CompareSide = {
  runId: "run_b",
  threadId: "thr_b",
  status: "succeeded",
  brief: { instructions: "Compare the three bids and add each one's setup cost." },
  result: "Harbor Supply fits best, and Pine's setup costs $300 more.",
  usdMicros: 52_000,
  tokens: 6_000,
  seconds: 9,
  model: "claude-opus-5-5",
};
interface Rec {
  cap: string;
  input: Record<string, unknown>;
}
function setup(over: { sides?: CompareSide[]; refuse?: Record<string, unknown>; member?: Partial<CrewMember> } = {}) {
  const calls: Rec[] = [];
  // a start that has not answered yet: the form stays up and a second press has to be turned away by the form itself
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const state = { sides: over.sides ?? [SIDES[0]!] };
  setupState = state;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (over.refuse?.[cap] !== undefined && cap.startsWith("runs.node.") && cap !== "runs.node.compare")
      throw over.refuse[cap];
    if (cap === "chat.helper.notes")
      return { notes: [{ messageId: "m1", who: "brief", authorId: "agt_boss", body: "Compare the three bids." }] };
    if (cap === "runs.node.compare") return { sides: state.sides };
    if (cap === "runs.node.rerun") {
      await held;
      state.sides = SIDES;
      return { threadId: "thr_b", rerunOf: "run_a" };
    }
    if (cap === "runs.node.save_as_agent") {
      await held;
      return { agent: {}, runId: "run_a" };
    }
    return {};
  };
  const view = () =>
    mount(
      createRoot,
      <CrewPeek
        member={M(over.member)}
        call={call}
        meId="usr_me"
        onBack={() => undefined}
        onOpenChat={() => undefined}
        onRefresh={() => undefined}
      />,
    );
  return { calls, view, release: () => release() };
}
const of = (calls: Rec[], cap: string): Rec[] => calls.filter((c) => c.cap === cap);

test("a finished helper can be saved as an agent: a name to confirm, one runs.node.save_as_agent, a second press sends nothing", async () => {
  const { calls, view, release } = setup();
  const root = await view();
  await press(find(root, "crew-save-agent"));
  assert.equal(find(root, "save-agent-name")?.props.value, "Tess");
  await typeInto(find(root, "save-agent-name"), "Bid reader");
  await press(find(root, "save-agent-go"));
  await press(find(root, "save-agent-go"));
  release();
  await flush();
  const sent = of(calls, "runs.node.save_as_agent");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.input, { runId: "run_a", name: "Bid reader", sharing: "me" });
  assert.match(textOf(find(root, "crew-agent-made")), /Bid reader\s+is now an agent/);
  assert.ok(find(root, "crew-save-agent") === null, "once made, the button is gone");
});

test("Save as an agent with no name sends nothing; a refusal says why and keeps the form", async () => {
  const { calls, view } = setup({
    refuse: { "runs.node.save_as_agent": { code: "validation.duplicate" } },
  });
  const root = await view();
  await press(find(root, "crew-save-agent"));
  await typeInto(find(root, "save-agent-name"), "  ");
  await press(find(root, "save-agent-go"));
  await flush();
  assert.equal(of(calls, "runs.node.save_as_agent").length, 0);
  await typeInto(find(root, "save-agent-name"), "Tess");
  await press(find(root, "save-agent-go"));
  await flush();
  assert.match(textOf(find(root, "save-agent-error")), /already in the Space/);
  assert.ok(find(root, "save-agent-form"), "the form stays so the name can change");
});

test("Run again waits for a change, then sends the new brief once, and the Compare tab shows the two sides", async () => {
  const { calls, view, release } = setup();
  const root = await view();
  assert.ok(find(root, "crew-peek-tab-compare") === null, "no compare before there is a re-run");
  await press(find(root, "crew-rerun"));
  assert.equal(find(root, "rerun-brief")?.props.value, "Compare the three bids.");
  await press(find(root, "rerun-go"));
  await flush();
  assert.equal(of(calls, "runs.node.rerun").length, 0, "nothing changed, nothing sent");
  await typeInto(find(root, "rerun-brief"), "Compare the three bids and add each one's setup cost.");
  await press(find(root, "rerun-go"));
  await press(find(root, "rerun-go"));
  release();
  await flush();
  const sent = of(calls, "runs.node.rerun");
  assert.equal(sent.length, 1, "a second press while it starts sends nothing");
  assert.deepEqual(sent[0]!.input, {
    runId: "run_a",
    instructions: "Compare the three bids and add each one's setup cost.",
  });
  assert.match(textOf(find(root, "crew-peek-tab-compare")), /Compare\s*1/);
  assert.match(textOf(find(root, "compare-side-0-result")), /Harbor Supply fits best/);
  assert.match(textOf(find(root, "compare-side-1-open")), /Starting/);
  assert.ok(find(root, "rerun-form") === null, "the form closes once it started");
  // the re-run finishes: the pane reads again by itself and fills the side in; the reads stop after that
  setupState.sides = [SIDES[0]!, DONE];
  await new Promise((r) => setTimeout(r, 5200));
  await flush();
  assert.match(textOf(find(root, "compare-side-1-result")), /Pine's setup costs \$300 more/);
  assert.match(textOf(find(root, "compare-diff-1")), /The brief changed/);
  assert.ok(find(root, "compare-side-1-open") === null);
  const reads = of(calls, "runs.node.compare").length;
  await new Promise((r) => setTimeout(r, 5200));
  assert.equal(of(calls, "runs.node.compare").length, reads, "nothing is going, so nothing is read");
});

test("a refused Run again says why in plain words and can be tried again", async () => {
  const { view } = setup({
    refuse: { "runs.node.rerun": { code: "validation.bad_input", details: { reason: "nothing_changed" } } },
  });
  const root = await view();
  await press(find(root, "crew-rerun"));
  await typeInto(find(root, "rerun-brief"), "Another brief");
  await press(find(root, "rerun-go"));
  await flush();
  assert.match(textOf(find(root, "rerun-error")), /Change the brief or the model/);
  assert.ok(find(root, "rerun-go"));
});

test("a person who cannot manage the run is told so, in words", async () => {
  const { view } = setup({
    refuse: {
      "runs.node.save_as_agent": { code: "permission.role_lacks_permission", details: { reason: "manage_required" } },
    },
  });
  const root = await view();
  await press(find(root, "crew-save-agent"));
  await press(find(root, "save-agent-go"));
  await flush();
  assert.match(textOf(find(root, "save-agent-error")), /Only the person who started it/);
});

test("no buttons for a helper still working, one with no run behind it, or with no person looking; a subagent can be saved but not run again", async () => {
  for (const member of [{ state: "working" as const }, { runId: undefined }]) {
    const { view } = setup({ member });
    const root = await view();
    assert.ok(find(root, "crew-finish-actions") === null);
  }
  const sub = setup({ member: { kind: "subagent" as never } });
  const r = await sub.view();
  assert.ok(find(r, "crew-save-agent"));
  assert.ok(find(r, "crew-rerun") === null);
  assert.equal(of(sub.calls, "runs.node.compare").length, 0, "a subagent is never compared");
});

test("the compare says what changed and fills in a finished re-run", () => {
  const done: CompareSide = {
    runId: "run_b",
    threadId: "thr_b",
    status: "succeeded",
    brief: { instructions: "Compare the three bids and add setup cost." },
    result: "Harbor Supply fits best, and Pine's setup costs $300 more.",
    usdMicros: 52_000,
    tokens: 6_000,
    seconds: 9,
    model: "claude-opus-5-5",
  };
  const fmt = { money: (n: number) => `$${(n / 1e6).toFixed(2)}`, model: (m: string) => m };
  assert.deepEqual(compareDiff(SIDES[0]!, done, fmt), [
    "The brief changed",
    "Model: claude-sonnet-5-5 to claude-opus-5-5",
    "The result is different",
    "$0.02 more than the first",
  ]);
  assert.deepEqual(compareDiff(SIDES[0]!, SIDES[1]!, fmt), [], "a side still going has nothing to compare yet");
  assert.equal(sideOpen(SIDES[1]!), true);
  assert.equal(sideOpen(done), false);
  assert.deepEqual([0, 1, 2].map(sideLabel), ["First run", "Run 2", "Run 3"]);
  assert.deepEqual(compareDiff(SIDES[0]!, { ...done, status: "failed" }, fmt).slice(-1), ["It could not finish"]);
});

test("the reads keep only what a side needs; a row with no status is dropped", () => {
  const s = sidesOf({
    sides: [
      { runId: "run_a", status: "succeeded", usdMicros: 5, tokens: 9, brief: { goal: "G" }, extra: 1 },
      { runId: "run_x" },
      "no",
      { threadId: "thr_b", status: "queued" },
    ],
  });
  assert.deepEqual(s, [
    { status: "succeeded", runId: "run_a", brief: { goal: "G" }, usdMicros: 5, tokens: 9 },
    { status: "queued", threadId: "thr_b", usdMicros: 0, tokens: 0 },
  ]);
  assert.deepEqual(sidesOf(null), []);
  assert.match(refusalWords(new Error("x"), "rerun"), /could not run again/);
});
