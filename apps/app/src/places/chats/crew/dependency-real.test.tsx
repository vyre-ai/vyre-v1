// The dependency line against the nodes the runtime really serves for a helper started after others (r42-runtime, chat.helper.start dependsOn, modules/runs/tests/node.helperwait.test.ts): the waiting helper's node is
// queued with dependsOn set, and a helper that has not had its first turn is a queued stand-in with a thread and no name. Rendered through the real provider, so the stand-in takes the name the strip shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { flush, installDom, mount } from "../../../../../../ui/src/testing/dom.ts";
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
  member({ id: "thr_x", title: "Calendar", name: "Calendar" }),
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
      errorMessage: "calendar could not finish",
    }),
    node({
      id: "run_d",
      name: "Docs",
      threadId: "thr_d",
      status: "failed",
      startedAt: 1_000,
      endedAt: 6_000,
      errorMessage: "It was to start after Calendar, which did not finish.",
    }),
  ] as never;
  const v = toRunView(docs, nodes);
  assert.equal(v.state, "failed");
  assert.deepEqual(v.lines, ["It was to start after Calendar, which did not finish."]);
  assert.equal(v.endedAt, 6_000);
  assert.equal(v.elapsedMs, 5_000, "the clock stops where the node ended");
  assert.equal(v.dependsLine, undefined);
  const cal = toRunView(member({ id: "thr_x", runId: "run_x", title: "Calendar", state: "failed" }), nodes);
  assert.deepEqual(cal.lines, ["calendar could not finish"]);
  // a helper that is really working keeps working, whatever an old node says
  const live = toRunView(docs, [node({ id: "run_d", status: "running" })] as never);
  assert.equal(live.state, "working");
});
