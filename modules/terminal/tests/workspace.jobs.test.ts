// Background jobs in an agent's workspace (rc.44; the owner's 24/7 pattern): a computer sleeps when idle and wakes on any trigger, but a job the agent starts keeps it awake until the job ends, with no 12 hour
// ceiling, and the container comes back after a reboot running the supervisor that starts the jobs again. The supervisor itself is tested in images/agent-workspace/supervisor.test.mjs with real processes; here the
// engine is a stand-in whose exec answers the three job scripts as the supervisor's folders would.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import {
  JOBS_LIST_SCRIPT,
  JOB_STOP_SCRIPT,
  JOB_WRITE_SCRIPT,
  MAX_BUSY_AWAKE_MS,
  WORKSPACE_SUPERVISOR,
  createWorkspaceManager,
  jobRowOf,
  reviewWorkspaceConfig,
  workspaceContainerConfig,
  workspaceName,
} from "../workspace.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";

const AGENT = "agt_dex";
const NAME = workspaceName(AGENT);

/** The supervisor's folders, in memory: what the three scripts read and write. */
function folders() {
  const jobs = new Map<
    string,
    { spec: Record<string, unknown>; status: Record<string, unknown> | null; tail: string }
  >();
  const onExec = (_box: string, argv: readonly string[], env: readonly string[]) => {
    if (argv[0] !== "node" || argv[1] !== "-e") return undefined;
    const e = Object.fromEntries(env.map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
    if (argv[2] === JOB_WRITE_SCRIPT) {
      const j = JSON.parse(e["VYRE_JOB"]!) as { id: string; spec: Record<string, unknown> };
      jobs.set(j.id, {
        spec: j.spec,
        status: { state: "running", restarts: 0, startedAt: 1000 },
        tail: "listening on 8080\n",
      });
      return { code: 0, stdout: "", stderr: "" };
    }
    if (argv[2] === JOB_STOP_SCRIPT) {
      const j = jobs.get(e["VYRE_JOB_ID"]!);
      if (!j) return { code: 3, stdout: "", stderr: "" };
      j.spec["desired"] = "stopped";
      j.status = { state: "stopped", restarts: 0, startedAt: 1000, exitCode: 143 };
      return { code: 0, stdout: "", stderr: "" };
    }
    if (argv[2] === JOBS_LIST_SCRIPT)
      return { code: 0, stdout: JSON.stringify([...jobs].map(([id, j]) => ({ id, ...j }))), stderr: "" };
    return undefined;
  };
  return { jobs, onExec };
}
function rig(o: { busy?: () => boolean } = {}) {
  const f = folders();
  const dk = fakeDocker({ onExec: f.onExec, procs: () => (o.busy?.() ? "4242 node server.js" : "") });
  const clock = { t: 1_000_000 };
  const mgr = createWorkspaceManager({
    api: createDockerApi(dk.http),
    http: dk.http,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    idleMs: 600_000,
  });
  return { f, dk, mgr, clock };
}

test("the container runs the job supervisor and comes back after a reboot, but a workspace put to sleep on purpose stays asleep", () => {
  const c = workspaceContainerConfig(AGENT, "vyre/agent-workspace:1", { projects: [] }, {});
  assert.deepEqual(c.Cmd, ["node", WORKSPACE_SUPERVISOR]);
  assert.deepEqual(c.HostConfig.RestartPolicy, { Name: "unless-stopped" });
  assert.deepEqual(reviewWorkspaceConfig(c, AGENT), []);
});

test("a job is started in the workspace (woken if asleep), listed with its state and last line, and stopped", async () => {
  const r = rig();
  const row = await r.mgr.jobStart(AGENT, { name: "web", command: "node server.js", restart: "on-failure" });
  assert.match(row.jobId, /^job_[a-f0-9]{12}$/);
  assert.equal(row.state, "running");
  assert.equal(row.lastLine, "listening on 8080");
  assert.equal(r.dk.box(NAME).running, true, "starting a job woke the workspace");
  assert.deepEqual(
    (await r.mgr.jobList(AGENT)).map((j) => j.name),
    ["web"],
  );
  const stopped = await r.mgr.jobStop(AGENT, row.jobId);
  assert.equal(stopped?.state, "stopped");
  assert.equal(await r.mgr.jobStop(AGENT, "job_000000000000"), null, "a job that is not there");
  assert.equal(await r.mgr.jobStop(AGENT, "../../etc"), null, "only a job id is taken");
});

test("a running job keeps the workspace awake past the 12 hour ceiling; without one the same workspace sleeps at the ceiling; a stopped job lets it sleep", async () => {
  // control: a process that is work, no job: it sleeps once the ceiling is over
  const c = rig({ busy: () => true });
  await c.mgr.exec(AGENT, ["tmux", "-V"]);
  c.clock.t += MAX_BUSY_AWAKE_MS + 700_000;
  assert.deepEqual(await c.mgr.sweep(), [AGENT], "no job: the ceiling applies");
  // the same, with a running job
  const r = rig({ busy: () => true });
  const row = await r.mgr.jobStart(AGENT, { name: "bot", command: "node bot.js", restart: "always" });
  for (let i = 0; i < 6; i++) {
    r.clock.t += 6 * 60 * 60_000;
    assert.deepEqual(await r.mgr.sweep(), [], `a job keeps it awake (${(i + 1) * 6} hours)`);
  }
  assert.equal(r.dk.box(NAME).running, true);
  await r.mgr.jobStop(AGENT, row.jobId);
  r.clock.t += 700_000;
  assert.deepEqual(
    await r.mgr.sweep(),
    [AGENT],
    "a stopped job lets the ordinary rules sleep it: nothing touched it for far longer than the ceiling",
  );
});

test("listing jobs never wakes a sleeping workspace and never counts as use", async () => {
  const r = rig();
  await r.mgr.jobStart(AGENT, { name: "web", command: "node server.js", restart: "on-failure" });
  await r.mgr.jobStop(AGENT, (await r.mgr.jobList(AGENT))[0]!.jobId);
  r.clock.t += 700_000;
  assert.deepEqual(await r.mgr.sweep(), [AGENT]);
  const execs = r.dk.ops("exec").length;
  assert.deepEqual(await r.mgr.jobList(AGENT), [], "asleep: nothing runs");
  assert.equal(r.dk.box(NAME).running, false);
  assert.equal(r.dk.ops("exec").length, execs, "nothing was run in it");
});

test("a row is read from the folders: restart waits, a missing status is starting, an ended job says how", () => {
  const spec = { command: "node a.js", name: "a", restart: "always", desired: "running" };
  assert.equal(jobRowOf({ id: "job_aaaaaaaaaaaa", spec, status: null, tail: "" })?.state, "starting");
  assert.equal(
    jobRowOf({ id: "job_aaaaaaaaaaaa", spec, status: { state: "restarting", restarts: 3 }, tail: "" })?.restarts,
    3,
  );
  const done = jobRowOf({
    id: "job_aaaaaaaaaaaa",
    spec,
    status: { state: "failed", exitCode: 2, restarts: 0 },
    tail: "x\n[supervisor] exited with code 2 after 1 s\n",
  });
  assert.equal(done?.state, "failed");
  assert.equal(done?.exitCode, 2);
  assert.equal(done?.lastLine, "x", "the supervisor's own lines are not the job's last line");
  assert.equal(jobRowOf({ id: "bad id", spec, status: null, tail: "" }), null);
  assert.equal(jobRowOf({ id: "job_aaaaaaaaaaaa", spec: {}, status: null, tail: "" }), null);
});
