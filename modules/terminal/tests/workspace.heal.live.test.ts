// @heavy docker
// The 12 Nov fixes on a real Docker engine and a real tmux: an agent's tab works after a daemon restart while its workspace sleeps; the idle sweep keeps a workspace up while a `sh -c` script typed in a
// person's tab or a job left in the background runs, and puts it to sleep once they end; a project change in the middle of a command lets the command finish, and the next command sees the new folder;
// two turns at once in one tab each get their own output. The module is the real one over the real manager; only the Space around it (a ctx and a database) is stood in.
// Runs only with VYRE_HEAVY_DOCKER=1. VYRE_WORKSPACE_TEST_IMAGE names an image built from images/agent-workspace, or one is built under a tag of this run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CODE_ROOT } from "../../../host/src/daemon/daemon.ts";
import { createLocalHost, handlers } from "../impl.ts";
import { bindHost, bindPlace, bindTeam, bindWorkspaces } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { buildWorkspaceManager, workspaceName } from "../workspace.ts";
import type { WorkspaceManager } from "../workspace.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { harness, reset } from "../fixtures/harness.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:heal-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const AGENT = `agtheal${Math.random().toString(36).slice(2, 8)}`;
const P1 = `prjheal${Math.random().toString(36).slice(2, 8)}`;
const P2 = `prjheal${Math.random().toString(36).slice(2, 8)}`;
const NAME = workspaceName(AGENT);

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let keys = 0;
const idem = (): string => `idem_heal_live_${++keys}`;

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}
const containerId = async (): Promise<string> => (await docker(["inspect", "-f", "{{.Id}}", NAME], 30_000)).out.trim().split("\n")[0] ?? "";
const running = async (): Promise<boolean> => (await docker(["inspect", "-f", "{{.State.Running}}", NAME], 30_000)).out.trim().split("\n")[0] === "true";
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("real Docker: a restart while asleep heals, the sweep sees scripts and background jobs, a project change waits for the command, two turns take turns", { skip, timeout: 900_000 }, async (t) => {
  if (PRESET === undefined) {
    const built = await docker(["build", "-t", IMAGE, "images/agent-workspace"], 800_000);
    assert.equal(built.code, 0, built.out.slice(-600));
  }
  let projects = [P1];
  const clock = { skew: 0 };
  const now = (): number => Date.now() + clock.skew;
  const managers: WorkspaceManager[] = [];
  const make = (): WorkspaceManager => { const m = buildWorkspaceManager({ http: unixSocketHttp(), image: IMAGE, idleMs: 600_000, projectsOf: () => projects, now }); managers.push(m); return m; };
  const hostOver = (m: WorkspaceManager) => createLocalHost({ exec: async () => ({ code: 127, stdout: "", stderr: "" }), shell: async () => ({ exitCode: 1 }), home: "/tmp", runsHere: () => false }, m);
  t.after(async () => {
    for (const m of managers) m.close();
    await docker(["rm", "-f", NAME], 60_000);
    await docker(["volume", "rm", "-f", `${NAME}-home`, `${NAME}-files`, `vyre-wsproj-${P1}`, `vyre-wsproj-${P2}`], 60_000);
    if (PRESET === undefined) await docker(["rmi", "-f", IMAGE], 60_000);
  });

  reset();
  bindTeam(() => true);
  bindWorkspaces(true);
  bindPlace(async () => ({ team: true, agentComputer: false, runsOn: "space" }));
  const hn = harness();
  const dana: TermCtx = { ...hn.as({ kind: "person", id: "usr_dana" }), call: (async (cap: string) => (cap === "agents.get" ? { agent: { agentId: AGENT, ownerId: "usr_dana", kind: "assistant" } } : undefined)) as never };
  const agent: TermCtx = { ...hn.as({ kind: "agent", id: AGENT }, "usr_dana", "run_1"), thread: "thr_1" };

  // ---- 1: a restart while the workspace sleeps
  let m = make();
  bindHost(hostOver(m));
  const first = await h["terminal.run"]!(agent, { command: "echo one", idempotencyKey: idem() });
  assert.deepEqual([first.exitCode, first.output], [0, "one"]);
  assert.equal(await m.sleep(AGENT), true);
  m.close();
  m = make();
  bindHost(hostOver(m));
  const healed = await h["terminal.run"]!(agent, { command: "echo two", idempotencyKey: idem() });
  assert.deepEqual([healed.terminalId, healed.exitCode, healed.output], [first.terminalId, 0, "two"], "the same tab, woken, after the restart");
  assert.equal(await running(), true);

  // ---- 6: the sweep and real work. A person types `sh -c '...'` in the attached tab: the pane's command reads as sh, a shell.
  await h["terminal.input"]!(dana, { terminalId: first.terminalId, data: "sh -c 'sleep 120; true'\r" });
  await settle(800);
  clock.skew += 700_000;
  assert.deepEqual(await m.sweep(), [], "sh -c is running: the workspace stays up");
  assert.equal(await running(), true);
  await h["terminal.interrupt"]!(dana, { terminalId: first.terminalId });
  await settle(500);
  // a job left in the background by the agent's own command
  const bg = await h["terminal.run"]!(agent, { command: "sleep 120 >/dev/null 2>&1 &", idempotencyKey: idem() });
  assert.equal(bg.exitCode, 0);
  clock.skew += 700_000;
  assert.deepEqual(await m.sweep(), [], "a job in the background is running: the workspace stays up");
  assert.equal(await running(), true);
  const killed = await h["terminal.run"]!(agent, { command: "kill %1; wait 2>/dev/null; true", idempotencyKey: idem() });
  assert.equal(killed.exitCode, 0);
  await settle(300);
  clock.skew += 700_000;
  assert.deepEqual(await m.sweep(), [AGENT], "nothing runs any more: it sleeps");
  assert.equal(await running(), false);

  // ---- 7: a project change in the middle of a command
  const awake = await h["terminal.run"]!(agent, { command: "echo awake", idempotencyKey: idem() });
  assert.equal(awake.exitCode, 0);
  const id0 = await containerId();
  const build = h["terminal.run"]!(agent, { command: "sleep 4; echo built", timeoutSec: 60, idempotencyKey: idem() });
  await settle(1200);
  projects = [P1, P2];
  const built = await build;
  assert.deepEqual([built.exitCode, built.output], [0, "built"], "the command ran to its end");
  assert.equal(await containerId(), id0, "the container was not made again while the command ran");
  const after = await h["terminal.run"]!(agent, { command: "ls ~/projects", idempotencyKey: idem() });
  assert.equal(after.exitCode, 0);
  assert.deepEqual(after.output.split(/\s+/).sort(), [P1, P2].sort(), "the next command sees the new project folder");
  assert.notEqual(await containerId(), id0, "made again once quiet, with the new mount");

  // ---- 5: two turns of the same agent at once, in its one tab
  const other: TermCtx = { ...agent, thread: "thr_2" };
  const [a, b] = await Promise.all([
    h["terminal.run"]!(agent, { command: "sleep 2; echo from-a", idempotencyKey: idem() }),
    h["terminal.run"]!(other, { command: "echo from-b", idempotencyKey: idem() }),
  ]);
  assert.equal(a.terminalId, b.terminalId, "one tab");
  assert.deepEqual([a.exitCode, a.output, b.exitCode, b.output], [0, "from-a", 0, "from-b"], "each got its own output, nothing typed into the other");
});
