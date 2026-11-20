// The dependency line against the nodes the runtime really serves for a helper started after others (r42-runtime, chat.helper.start dependsOn, modules/runs/tests/node.helperwait.test.ts): the waiting helper's node is
// queued with dependsOn set, and a helper that has not had its first turn is a queued stand-in with a thread and no name. Rendered through the real provider, so the stand-in takes the name the strip shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { CrewBlock } from "../session/CrewBlock.tsx";
import { totalsOf } from "./model.ts";
import { nameStandIns } from "./run/model.ts";
import { CrewProvider, useCrew } from "./context.tsx";
import { toRunView } from "./run-view.ts";
import type { CrewMember } from "./model.ts";

installDom();

const member = (o: Partial<CrewMember>): CrewMember =>
  ({
    kind: "helper",
    parentThreadId: "thr_0",
    agentId: "agt_x",
    state: "working",
    startedAt: 1_000,
    elapsedMs: 4_000,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    ...o,
  }) as CrewMember;
const MEMBERS = [
  member({ id: "thr_n", runId: "run_n", title: "Numbers", name: "Numbers" }),
  member({ id: "thr_x", runId: "run_x", title: "Calendar", name: "Calendar" }),
  member({ id: "thr_d", runId: "run_d", title: "Docs", name: "Docs" }),
];
const node = (o: Record<string, unknown>) => ({
  kind: "helper",
  status: "running",
  spent: { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0 },
  startedAt: 1_000,
  rootRun: "run_root",
  ...o,
});
// as the runtime stores them: Numbers ran, Calendar is a queued stand-in under its own thread (no name), Docs is queued behind both
const tree = (numbers: string, calendar: string) => ({
  nodes: [
    node({ id: "run_root", kind: "turn", rootRun: "run_root", status: "running" }),
    node({ id: "run_n", name: "Numbers", threadId: "thr_n", status: numbers, parentRun: "run_root" }),
    node({ id: "run_x", threadId: "thr_x", status: calendar, parentRun: "run_root" }),
    node({
      id: "run_d",
      name: "Docs",
      threadId: "thr_d",
      status: "queued",
      dependsOn: ["run_n", "run_x"],
      parentRun: "run_root",
    }),
  ],
});

async function lineFor(numbers: string, calendar: string): Promise<string | undefined> {
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "engine.crew.status")
      return { members: MEMBERS, totals: { members: 3, working: 3, done: 0, needsYou: 0, failed: 0, stopped: 0 } };
    if (cap === "runs.tree.find") return { roots: [{ rootRun: "run_root", runId: "run_root", full: true }] };
    if (cap === "runs.tree.get") return tree(numbers, calendar);
    if (cap === "chat.helper.notes") return { notes: [] };
    return {};
  };
  let seen: string | undefined;
  const Probe = (): null => {
    const c = useCrew();
    const docs = c?.status?.members.find((m) => m.id === "thr_d");
    if (docs && c) seen = toRunView(docs, c.nodes).dependsLine;
    return null;
  };
  await mount(
    createRoot,
    <CrewProvider call={call} threadId="thr_0">
      <Probe />
    </CrewProvider>,
  );
  await flush();
  await flush();
  return seen;
}

test("a helper queued behind two others says who it waits for, by the names the strip shows, also for one that has not had its first turn", async () => {
  assert.equal(await lineFor("running", "queued"), "Starts when Numbers and Calendar are done");
});

test("the line follows what finishes: one done, then the rest; one that failed says it cannot start", async () => {
  assert.equal(await lineFor("succeeded", "queued"), "Starts when Calendar is done");
  assert.equal(await lineFor("succeeded", "failed"), "Can't start: Calendar failed");
  assert.equal(await lineFor("succeeded", "succeeded"), undefined, "nothing left to wait for");
});

test("a helper the host failed before it ever ran shows as failed with the reason, not as working with a clock that keeps counting; a failed one with no words of its own says what the node says", async () => {
  const docs = MEMBERS[2]!; // the strip lists it as working: its own chat never started
  const nodes = [
    node({
      id: "run_x",
      name: "Calendar",
      threadId: "thr_x",
      status: "failed",
      reason: "It could not finish.",
    }),
    node({
      id: "run_d",
      name: "Docs",
      threadId: "thr_d",
      status: "failed",
      dependsOn: ["run_x"],
      errorCode: "dependency_failed",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_005_000,
      reason: "Didn't start because Calendar failed.",
    }),
  ] as never;
  const v = toRunView(docs, nodes);
  assert.equal(v.state, "failed");
  assert.deepEqual(v.lines, ["Didn't start because Calendar failed."]);
  assert.equal(v.endedAt, 1_700_000_005_000);
  assert.equal(v.blocked, true, "it never ran because Calendar failed: no clock, no Retry");
  assert.equal(v.dependsLine, undefined);
  const cal = toRunView(member({ id: "thr_x", runId: "run_x", title: "Calendar", state: "failed" }), nodes);
  assert.deepEqual(cal.lines, ["It could not finish."]);
  assert.equal(cal.blocked, undefined, "Calendar itself can be tried again");
  // a helper that is really working keeps working, whatever an old node says
  const live = toRunView(docs, [node({ id: "run_d", status: "running" })] as never);
  assert.equal(live.state, "working");
  // the clock is the node's own, never the member's start: a node that began 3 s ago reads 3 s whatever the member says
  const running = toRunView(member({ id: "thr_n", runId: "run_n", title: "Numbers", startedAt: 5 }), [
    node({ id: "run_n", status: "running", startedAt: 1_700_000_000_000 }),
  ] as never);
  assert.equal(running.startedAt, 1_700_000_000_000);
  assert.equal(running.elapsedMs, 0, "while it runs the clock counts from the node's start to now");
  const done = toRunView(
    member({ id: "thr_n", runId: "run_n", title: "Numbers", state: "done", startedAt: 5, elapsedMs: 99 }),
    [node({ id: "run_n", status: "succeeded", startedAt: 1_700_000_000_000, endedAt: 1_700_000_007_000 })] as never,
  );
  assert.equal(done.elapsedMs, 7_000);
});

test("as rows too: a helper waiting for another says so and has no clock; one the host failed before it started is Failed with no Retry and no clock, never Working", async () => {
  const props = (members: CrewMember[], nodes: unknown[]) => ({
    members,
    totals: totalsOf(members),
    view: "rows" as const,
    call: async () => ({}),
    nodes: nodes as never,
    meId: "usr_me",
    onPeek: () => undefined,
    onOpenPane: () => undefined,
    onStopAll: () => undefined,
    onRetry: () => undefined,
  });
  const waiting = await mount(
    createRoot,
    <CrewBlock
      {...props(
        MEMBERS,
        nameStandIns(tree("running", "queued").nodes, new Map(MEMBERS.map((m) => [m.id, m.title] as const))),
      )}
    />,
  );
  await flush();
  assert.match(textOf(find(waiting, "row-crew-chip-thr_d-toggle")), /Starts when Numbers and Calendar are done/);
  assert.match(textOf(find(waiting, "crew-chip-thr_d-state")), /Waiting/);
  assert.equal(textOf(find(waiting, "crew-chip-thr_d-time")).trim(), "", "it has not started, so no clock");
  const failedNodes = [
    node({
      id: "run_x",
      name: "Calendar",
      threadId: "thr_x",
      status: "failed",
      reason: "It could not finish.",
    }),
    node({
      id: "run_d",
      name: "Docs",
      threadId: "thr_d",
      status: "failed",
      dependsOn: ["run_x"],
      errorCode: "dependency_failed",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_005_000,
      reason: "Didn't start because Calendar failed.",
    }),
  ];
  const failed = await mount(createRoot, <CrewBlock {...props(MEMBERS, failedNodes)} />);
  await flush();
  assert.match(textOf(find(failed, "crew-chip-thr_d-state")), /Failed/);
  assert.ok(find(failed, "crew-chip-thr_d-retry") === null, "retrying it alone only fails again");
  assert.ok(find(failed, "crew-chip-thr_x-retry"), "the one that failed can be tried again");
  assert.equal(textOf(find(failed, "crew-chip-thr_d-time")).trim(), "", "it never ran: no clock");
});
