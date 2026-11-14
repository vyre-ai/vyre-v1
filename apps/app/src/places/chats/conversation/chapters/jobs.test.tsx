// Background jobs in a chat (G45): a running terminal of an agent in the chat is one quiet line, a finished one leaves one line, a shell at its prompt is no job, and nothing is asked of the server for a chat with no agent.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import { ChapterLayer } from "./ChapterLayer.tsx";
import { JobLines } from "./JobLines.tsx";
import { finishedWords, jobsOf, runningWords, settle, titleOf } from "./jobs.ts";
import type { Term } from "./jobs.ts";
import { ownSeq } from "./model.ts";

installDom();

const MIN = 60_000;
const T = (o: Partial<Term> & { terminalId: string }): Term => ({
  name: "tests",
  agentId: "agt_a",
  state: "running",
  exitCode: null,
  createdAt: 0,
  lastActiveAt: 0,
  ...o,
});
const mine = new Set(["agt_a"]);

test("a running terminal of an agent in the chat is a job; an idle shell, a stranger's terminal and another agent's are not", () => {
  const terms = [
    T({ terminalId: "t1", name: "unit-tests", createdAt: 2 * MIN }),
    T({ terminalId: "t2", state: "idle" }),
    T({ terminalId: "t3", agentId: "agt_other" }),
    T({ terminalId: "t4", agentId: undefined }),
    T({ terminalId: "t5", name: "build", createdAt: MIN }),
  ];
  assert.deepEqual(
    jobsOf(terms, mine).map((j) => [j.id, j.title]),
    [
      ["t5", "Build"],
      ["t1", "Unit tests"],
    ],
  );
  assert.equal(titleOf(""), "Command");
});

test("the words: running reads title, time and Background; finished reads how it ended", () => {
  assert.deepEqual(runningWords({ id: "t1", title: "Tests", startedAt: 0 }, 14 * MIN), {
    title: "Tests",
    time: "14 min",
    tag: "Background",
  });
  assert.equal(finishedWords({ id: "t1", title: "Tests", ms: 2 * MIN, ok: true }), "Tests finished in 2 min");
  assert.equal(finishedWords({ id: "t1", title: "Tests", ms: 3 * MIN, ok: false }), "Tests failed after 3 min");
});

test("a job that was running and now is not leaves one line, ok by its exit code; one that vanished is read as finished", () => {
  const before = jobsOf([T({ terminalId: "t1", createdAt: 0 }), T({ terminalId: "t2", createdAt: 0 })], mine);
  const next = settle(
    before,
    [T({ terminalId: "t1", state: "exited", exitCode: 1, lastActiveAt: 5 * MIN })],
    mine,
    9 * MIN,
  );
  assert.equal(next.running.length, 0);
  assert.deepEqual(
    next.finished.map((f) => [f.id, f.ok, f.ms]),
    [
      ["t1", false, 5 * MIN],
      ["t2", true, 9 * MIN],
    ],
  );
  assert.deepEqual(
    settle([], [T({ terminalId: "t9", state: "exited" })], mine, 0).finished,
    [],
    "a terminal never seen running leaves nothing",
  );
});

test("the lines draw a running job and a finished one", async () => {
  const el = await mount(
    createRoot,
    <JobLines
      running={[{ id: "t1", title: "Tests", startedAt: 0 }]}
      finished={[{ id: "t0", title: "Build", ms: MIN, ok: true }]}
      now={2 * MIN}
    />,
  );
  assert.match(textOf(find(el, "job-running-t1")), /Tests.*2 min.*Background/);
  assert.match(textOf(find(el, "job-done-t0")), /Build finished in 1 min/);
  assert.equal(find(await mount(createRoot, <JobLines running={[]} finished={[]} now={0} />), "job-lines"), null);
});

test("the layer reads terminals for a chat with agents, shows a running job, and asks for nothing without agents", async () => {
  const calls: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    return { terminals: [T({ terminalId: "t1", createdAt: Date.now() - 3 * MIN })] };
  };
  const el = (agents: string[]) => (
    <ChapterLayer
      call={call}
      threadId="thr_1"
      size={5}
      newest={5}
      focusSeq={null}
      jobs={{ agentIds: agents, working: false }}
      rows={[]}
      own={ownSeq}
      clock={{ now: 0, offsetMin: 0 }}
    >
      {(laid) => laid.jobs}
    </ChapterLayer>
  );
  await mount(createRoot, el([]));
  await flush();
  assert.deepEqual(calls, []);
  const root = await mount(createRoot, el(["agt_a"]));
  await act(async () => {
    await flush();
  });
  assert.deepEqual(calls, ["terminal.list"]);
  assert.match(textOf(find(root, "job-running-t1")), /Tests.*3 min.*Background/);
});
