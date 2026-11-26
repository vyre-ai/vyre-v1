// terminal.job.start, stop and list (rc.44): an agent keeps a command running on its own computer; a person names the agent whose computer they may enter; no Vault value is given to a job; a stop of a job that is
// not there is not found; with no workspace on this host the plain reason comes back. Every input and output is checked against the frozen contract; the workspace is a stand-in (workspace.jobs.test.ts has the engine).
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindWorkspaceJobs, bindHost } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { JobRow, JobSpec } from "../workspace.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWN = { kind: "agent" as const, id: "agt_intake" };
const OTHER = { kind: "agent" as const, id: "agt_other" };

function setup(bound = true) {
  reset();
  const hn = harness();
  bindHost(fakeHost({}).host);
  const started: Array<{ agentId: string; spec: JobSpec }> = [];
  const rows = new Map<string, JobRow>();
  if (bound)
    bindWorkspaceJobs({
      list: async (agentId) => [...rows.values()].filter(() => agentId === "agt_intake"),
      start: async (agentId, spec) => {
        started.push({ agentId, spec });
        const row: JobRow = {
          jobId: "job_a1b2c3d4e5f6",
          name: spec.name,
          command: spec.command,
          state: "running",
          restart: spec.restart,
          restarts: 0,
        };
        rows.set(row.jobId, row);
        return row;
      },
      stop: async (_agentId, jobId) => {
        const row = rows.get(jobId);
        if (!row) return null;
        const next: JobRow = { ...row, state: "stopped" };
        rows.set(jobId, next);
        return next;
      },
    });
  else bindWorkspaceJobs(null);
  return { hn, started };
}
const call = async (ctx: Harness["ctx"], cap: string, input: Record<string, unknown>): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const code = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (e) {
    return codeOf(e);
  }
  return "no error";
};

test("an agent keeps a command running on its own computer, sees it listed, and stops it", async () => {
  const { hn, started } = setup();
  const agent = hn.as(OWN, "usr_dana", "run_1");
  const out = await call(agent, "terminal.job.start", {
    command: "  node server.js  ",
    name: "web",
    restart: "always",
    idempotencyKey: "k1",
  });
  assert.equal(out.job.state, "running");
  assert.deepEqual(started, [
    { agentId: "agt_intake", spec: { name: "web", command: "node server.js", restart: "always" } },
  ]);
  assert.equal((await call(agent, "terminal.job.list", {})).jobs.length, 1);
  const stopped = await call(agent, "terminal.job.stop", { jobId: "job_a1b2c3d4e5f6" });
  assert.equal(stopped.job.state, "stopped");
  assert.equal(
    await code(() => call(agent, "terminal.job.stop", { jobId: "job_000000000000" })),
    "validation.not_found",
  );
});

test("the name defaults to the command, the restart policy to on-failure, and an env, a folder are passed on", async () => {
  const { hn, started } = setup();
  await call(hn.as(OWN, "usr_dana", "run_1"), "terminal.job.start", {
    command: "python3 -m http.server",
    cwd: "/home/agent/site",
    env: { PORT: "8080" },
    idempotencyKey: "k2",
  });
  assert.deepEqual(started[0]!.spec, {
    name: "python3 -m http.server",
    command: "python3 -m http.server",
    cwd: "/home/agent/site",
    env: { PORT: "8080" },
    restart: "on-failure",
  });
});

test("a person names the agent; an agent cannot keep jobs on another agent's computer; no Vault value goes into a job", async () => {
  const { hn } = setup();
  assert.equal(
    await code(() => h["terminal.job.list"]!(hn.ctx, {})),
    "validation.bad_input",
    "a person must say whose computer",
  );
  assert.equal((await call(hn.ctx, "terminal.job.list", { agentId: "agt_intake" })).jobs.length, 0);
  assert.equal(
    await code(() =>
      call(hn.as(OTHER, "usr_dana", "run_1"), "terminal.job.start", {
        command: "node a.js",
        agentId: "agt_intake",
        idempotencyKey: "k3",
      }),
    ),
    "permission.role_lacks_permission",
  );
  assert.equal(
    await code(() =>
      call(hn.as(OWN, "usr_dana", "run_1"), "terminal.job.start", {
        command: "node a.js",
        env: { TOKEN: "#Stripe.api_key" },
        idempotencyKey: "k4",
      }),
    ),
    "validation.bad_input",
  );
  assert.equal(
    await code(() =>
      call(hn.as(OWN, "usr_dana", "run_1"), "terminal.job.start", { command: "   ", idempotencyKey: "k5" }),
    ),
    "validation.bad_input",
  );
});

test("with no workspace on this host the reason comes back plainly and nothing runs", async () => {
  const { hn } = setup(false);
  assert.equal(
    await code(() =>
      call(hn.as(OWN, "usr_dana", "run_1"), "terminal.job.start", { command: "node a.js", idempotencyKey: "k6" }),
    ),
    "validation.precondition_failed",
  );
  assert.equal(
    await code(() => call(hn.as(OWN, "usr_dana", "run_1"), "terminal.job.list", {})),
    "validation.precondition_failed",
  );
});
