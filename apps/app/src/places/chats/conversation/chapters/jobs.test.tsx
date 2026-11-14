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

function feedOf(terminals: Term[]) {
  let rows = terminals;
  const subs = new Set<() => void>();
  const snap = { status: "ready", data: { terminals: rows } };
  let cur = snap;
  return {
    screens: {
      query: (): unknown => ({
        subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
        getSnapshot: () => cur,
      }),
    },
    set(next: Term[]) {
      rows = next;
      cur = { status: "ready", data: { terminals: rows } };
      for (const f of subs) f();
    },
  };
}

test("the job line rides the live terminal rows: a running job shows, then leaves one finished line when the row ends; no reads", async () => {
  const f = feedOf([T({ terminalId: "t1", createdAt: Date.now() - 3 * MIN })]);
  const el = (agents: string[]) => (
    <ChapterLayer
      call={async () => ({})}
      threadId="thr_1"
      size={5}
      newest={5}
      focusSeq={null}
      jobs={{ agentIds: agents, screens: f.screens }}
      rows={[]}
      own={ownSeq}
      clock={{ now: 0, offsetMin: 0 }}
    >
      {(laid) => laid.jobs}
    </ChapterLayer>
  );
  const none = await mount(createRoot, el([]));
  assert.equal(find(none, "job-lines"), null, "no agent in the chat, no job");
  const root = await mount(createRoot, el(["agt_a"]));
  await flush();
  assert.match(textOf(find(root, "job-running-t1")), /Tests.*3 min.*Background/);
  await act(async () => f.set([T({ terminalId: "t1", state: "exited", exitCode: 0, lastActiveAt: Date.now() })]));
  await flush();
  assert.equal(find(root, "job-running-t1"), null);
  assert.match(textOf(find(root, "job-done-t1")), /Tests finished/);
});

test("a build without the terminal screen, or a feed that fails, draws nothing and calls nothing", async () => {
  const boom = {
    query: (): unknown => {
      throw new Error("no such screen");
    },
  };
  const errored = { status: "error" };
  const bad = { query: (): unknown => ({ subscribe: () => () => undefined, getSnapshot: () => errored }) };
  for (const screens of [boom, bad, undefined]) {
    const el = await mount(
      createRoot,
      <ChapterLayer
        call={async () => {
          throw new Error("no call expected");
        }}
        threadId="thr_1"
        size={5}
        newest={5}
        focusSeq={null}
        jobs={{ agentIds: ["agt_a"], screens }}
        rows={[]}
        own={ownSeq}
        clock={{ now: 0, offsetMin: 0 }}
      >
        {(laid) => laid.jobs}
      </ChapterLayer>,
    );
    await flush();
    assert.equal(find(el, "job-lines"), null);
  }
});

test("in a chat read by two people the line says only that work runs in the background, with the clock and no name; alone it names the job", async () => {
  const f = feedOf([T({ terminalId: "t1", name: "unit-tests", createdAt: Date.now() - 2 * MIN })]);
  const el = (shared: boolean) => (
    <ChapterLayer
      call={async () => ({})}
      threadId="thr_1"
      size={5}
      newest={5}
      focusSeq={null}
      jobs={{ agentIds: ["agt_a"], screens: f.screens, shared }}
      rows={[]}
      own={ownSeq}
      clock={{ now: 0, offsetMin: 0 }}
    >
      {(laid) => laid.jobs}
    </ChapterLayer>
  );
  const two = await mount(createRoot, el(true));
  await flush();
  const said = textOf(find(two, "job-running-t1"));
  assert.match(said, /Working in the background.*2 min.*Background/);
  assert.doesNotMatch(said, /Unit tests/);
  await act(async () =>
    f.set([T({ terminalId: "t1", name: "unit-tests", state: "exited", exitCode: 0, lastActiveAt: Date.now() })]),
  );
  await flush();
  assert.doesNotMatch(textOf(find(two, "job-done-t1")), /Unit tests/);
  await act(async () => f.set([T({ terminalId: "t1", name: "unit-tests", createdAt: Date.now() - 2 * MIN })]));
  const alone = await mount(createRoot, el(false));
  await flush();
  assert.match(textOf(find(alone, "job-done-t1")) + textOf(find(alone, "job-running-t1")), /Unit tests/);
});
