// The agent's background jobs in the Computer tab (rc.44): a row per job with what it is doing, a Stop on a job that runs (and on nothing else), and the words for every state. The owner's pattern: a computer
// sleeps when idle, but a job the agent starts keeps it awake until it ends, and it is seen here.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { RightPaneDataProvider } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { WorkSections } from "./WorkSections.tsx";
import { jobWords } from "./work-model.ts";
import type { JobView, WorkspaceData, WorkspaceView } from "./work-model.ts";
import { createSample } from "./sample.ts";
import type { PaneDeps } from "./actions.ts";

const ALL = { start: 0, end: 500 };

test("the words of a job: running shows its last line and how often it restarted; ended jobs say how", () => {
  const j = (over: Partial<JobView>): JobView => ({
    jobId: "job_aaaaaaaaaaaa",
    name: "web",
    state: "running",
    restarts: 0,
    ...over,
  });
  assert.deepEqual(jobWords(j({ lastLine: "listening on 8080" })), {
    note: "listening on 8080",
    word: "Running",
    dot: "run",
  });
  assert.equal(jobWords(j({ restarts: 2, lastLine: "ok" })).note, "ok Restarted 2 times.");
  assert.equal(jobWords(j({ restarts: 1 })).note, "Running. Restarted 1 time.");
  assert.equal(jobWords(j({ state: "restarting", restarts: 3 })).word, "Restarting");
  assert.equal(jobWords(j({ state: "stopped" })).note, "Stopped. Its log is kept.");
  assert.equal(jobWords(j({ state: "done" })).word, "Done");
  assert.equal(jobWords(j({ state: "failed", exitCode: 2 })).note, "Ended with an error (code 2).");
});

test("jobs are rows under the terminals: a running one has Stop, which stops it; a stopped one says Stopped and has no button", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const stopped: string[] = [];
    const view: WorkspaceView = {
      state: "running",
      canAttach: true,
      sessions: [{ name: "main", terminalId: "trm_main", state: "idle", owner: { kind: "agent" } }],
      jobs: [
        { jobId: "job_aaaaaaaaaaaa", name: "web server", state: "running", restarts: 1, lastLine: "listening on 8080" },
        { jobId: "job_bbbbbbbbbbbb", name: "nightly sync", state: "stopped", restarts: 0 },
      ],
    };
    const workspace: WorkspaceData = {
      watch: (_a, on) => {
        on(view);
        return () => undefined;
      },
      wake: async () => undefined,
      attach: async () => undefined,
      stopJob: async (_a, id) => void stopped.push(id),
    };
    const data: ChatRightPaneData = {
      ...s.data,
      agent: { agentId: s.data.agent.agentId, name: s.data.agent.name },
      workspace,
    };
    const deps: PaneDeps = { call: async () => ({}), note: () => undefined };
    const root = await mount(
      createRoot,
      <RightPaneDataProvider value={data}>
        <WorkSections deps={deps} window={ALL} />
      </RightPaneDataProvider>,
    );
    await flush();
    assert.match(textOf(find(root, "row-job-job_aaaaaaaaaaaa")), /web server/);
    assert.match(textOf(find(root, "row-job-job_aaaaaaaaaaaa")), /listening on 8080/);
    assert.match(textOf(find(root, "row-job-job_bbbbbbbbbbbb")), /Stopped/);
    assert.equal(find(root, "job-stop-job_bbbbbbbbbbbb"), null, "no Stop on a job that is not running");
    await press(find(root, "job-stop-job_aaaaaaaaaaaa"));
    await flush();
    assert.deepEqual(stopped, ["job_aaaaaaaaaaaa"]);
  } finally {
    off();
  }
});

test("a job that kept crashing says so and has no Stop", () => {
  const w = jobWords({ jobId: "job_aaaaaaaaaaaa", name: "web", state: "failed", restarts: 20, loop: true });
  assert.equal(w.word, "Failed");
  assert.match(w.note, /kept crashing and was stopped/);
});
