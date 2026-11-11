// An agent's terminal keeps working across what happens to its workspace on the way (12 Nov round): a daemon restart while the workspace sleeps or after tmux lost its sessions, a project change in the
// middle of a command, an idle sweep while a script or a background job runs, two turns of the same agent at once, two helpers with one name. The Docker engine is the stand-in (fixtures/fake-docker.ts)
// behind the real DockerApi, and the handlers run against the real host stack (createLocalHost over the workspace terminal host), so a restart is a new manager and a new host over the same engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import { createWorkspaceManager, createWorkspaceTerminalHost, workspaceName } from "../workspace.ts";
import type { WorkspaceManager, WorkspaceOptions } from "../workspace.ts";
import { createLocalHost, handlers } from "../impl.ts";
import { bindHost, bindWorkspaces } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";
import type { FakeDockerOptions } from "../fixtures/fake-docker.ts";
import { fakeTmux } from "../fixtures/fake-tmux.ts";
import { codeOf, fakeHost, harness, reset } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = "agt_dex";
const NAME = workspaceName(AGENT);
let keys = 0;
const idem = (): string => `idem_heal_${++keys}`;
const fast = async (): Promise<void> => { await new Promise((x) => setTimeout(x, 1)); };
const until = async (f: () => boolean, what: string, ms = 3000): Promise<void> => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((x) => setTimeout(x, 5)); assert.ok(f(), `timed out waiting for ${what}`); };

function engine(o: FakeDockerOptions = {}) {
  return fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 }, "build": { hang: true } } }, ...o });
}
const manager = (dk: ReturnType<typeof engine>, extra: Partial<WorkspaceOptions> = {}): WorkspaceManager => createWorkspaceManager({ api: createDockerApi(dk.http), http: dk.http, idleMs: 600_000, ...extra });
/** The daemon's host stack for one process: this computer (no tmux here: a plain shell) and the agent workspaces over `m`. */
const daemonHost = (m: WorkspaceManager) => createLocalHost({ exec: fakeTmux({ installed: false }).exec, shell: async () => ({ exitCode: 0 }), home: "/home/person", runsHere: () => true }, createWorkspaceTerminalHost({ manager: m, sleep: fast }));

function setup() {
  reset();
  bindWorkspaces(true);
  const hn = harness();
  const agent: TermCtx = { ...hn.as({ kind: "agent", id: AGENT }, "usr_dana", "run_1"), thread: "thr_chat" };
  return { hn, agent };
}

// ---- 1: a restart, with the workspace asleep or tmux gone --------------------------------------------------------------------------------------------------

test("after a daemon restart while the workspace sleeps, the agent's next command wakes it and runs in the same tab, with no special step", async () => {
  const { agent } = setup();
  const dk = engine();
  const before = manager(dk);
  bindHost(daemonHost(before));
  const first = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  assert.equal(first.exitCode, 0);
  assert.equal(await before.sleep(AGENT), true);
  before.close();
  // the update restarts vyred: a new manager and a new host over the same Docker, the session row still open
  const after = manager(dk);
  bindHost(daemonHost(after));
  const st = await h["terminal.status"]!(agent, { terminalIds: [first.terminalId] });
  assert.equal(st.rows[0].state, "idle", "asleep is idle, not exited, and a status read does not wake it");
  assert.equal(dk.box(NAME).running, false);
  const again = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual([again.terminalId, again.exitCode, again.output], [first.terminalId, 0, "hi"]);
  assert.equal(dk.box(NAME).running, true, "the command woke the workspace");
  after.close();
});

test("after a restart with the workspace running but its tmux sessions gone, the next command makes the session again and runs", async () => {
  const { agent } = setup();
  const dk = engine();
  const before = manager(dk);
  bindHost(daemonHost(before));
  const first = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  before.close();
  // tmux lost every session (its server died) while the container kept running
  dk.box(NAME).tmux = fakeTmux({ scripts: { "echo hi": { out: "hi", code: 0 } } });
  const after = manager(dk);
  bindHost(daemonHost(after));
  const again = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual([again.terminalId, again.exitCode, again.output], [first.terminalId, 0, "hi"]);
  // a person's tab on the same session reads it too
  const screen = await h["terminal.read"]!(agent, { terminalId: first.terminalId, lines: 20 });
  assert.match(screen.text, /^hi$/m);
  after.close();
});

test("within one process, a session tmux lost under a running workspace is made again before the next command is typed", async () => {
  const { agent } = setup();
  const dk = engine();
  const m = manager(dk);
  bindHost(daemonHost(m));
  const first = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  dk.box(NAME).tmux = fakeTmux({ scripts: { "echo hi": { out: "hi", code: 0 } } });
  const again = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual([again.terminalId, again.exitCode], [first.terminalId, 0]);
  const typed = dk.box(NAME).tmux.calls.filter((c) => c[1] === "send-keys" && c.includes("-l"));
  assert.equal(typed.length, 1, "the command was typed once");
  m.close();
});

test("after a restart, a plain session on this computer (no tmux here) is made again in its folder rather than pointing at nothing", async () => {
  reset();
  const hn = harness();
  const seam = { exec: fakeTmux({ installed: false }).exec, shell: async (a: { onData(t: string): void }) => { a.onData("ok\n"); return { exitCode: 0 }; }, home: "/home/person", runsHere: () => true };
  bindHost(createLocalHost(seam));
  const t = await h["terminal.open"]!(hn.ctx, { host: "device", deviceId: "dev_mac", idempotencyKey: idem() });
  bindHost(createLocalHost(seam));
  const r = await h["terminal.run"]!(hn.ctx, { command: "echo ok", terminalId: t.terminal.terminalId, host: "device", idempotencyKey: idem() });
  assert.deepEqual([r.exitCode, r.output], [0, "ok"]);
});

// ---- 4: the idle timer after a restart ------------------------------------------------------------------------------------------------------------------

test("a workspace that was running when the daemon restarted sleeps after its idle time even when nothing uses it again", async () => {
  const dk = engine();
  const before = manager(dk);
  await before.ensure(AGENT);
  before.close();
  const after = manager(dk, { idleMs: 1500 });
  await until(() => dk.box(NAME).running === false, "the sweep of the new process", 6000);
  after.close();
});

// ---- 6: what the idle sweep counts as work ------------------------------------------------------------------------------------------------------------------

test("the idle sweep counts a script run by a shell, sh -c and a job in the background as work, though every pane's foreground command is bash", async () => {
  let procs = "4711";
  const clock = { t: 1_000_000 };
  const dk = engine({ panes: () => "bash", procs: () => procs });
  const m = manager(dk, { now: () => clock.t });
  await m.exec(AGENT, ["tmux", "-V"]);
  clock.t += 700_000;
  assert.deepEqual(await m.sweep(), [], "bash build.sh is still running");
  assert.equal(dk.box(NAME).running, true);
  procs = "";
  clock.t += 700_000;
  assert.deepEqual(await m.sweep(), [AGENT], "nothing but the shells: it sleeps");
  m.close();
});

test("the sweep looks again at the moment of sleeping: a command that began after it looked is not cut off", async () => {
  const clock = { t: 1_000_000 };
  let m: WorkspaceManager;
  let raced = false;
  const dk = engine({ panes: () => { if (!raced) { raced = true; void m.exec(AGENT, ["tmux", "-V"]); } return "bash"; } });
  m = manager(dk, { now: () => clock.t });
  await m.exec(AGENT, ["tmux", "-V"]);
  clock.t += 700_000;
  assert.deepEqual(await m.sweep(), [], "a command came in while the sweep looked");
  assert.equal(dk.ops("stop").length, 0, "the container was never stopped");
  m.close();
});

// ---- 7: a project change while a command runs -------------------------------------------------------------------------------------------------------------

test("a project change in the middle of a command waits for the command: the container is not touched until it ends, then the next command gets the new folder", async () => {
  let projects = ["prj_site"];
  const dk = engine();
  const m = manager(dk, { projectsOf: () => projects, sleep: fast });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_1", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 100, rows: 30, folders: [] });
  const build = host.run("trm_1", { command: "build", env: {}, timeoutMs: 20_000 });
  await until(() => dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")), "the build to be typed");
  // an admin adds the agent to a project while the build runs; the run's own reads of the screen keep going
  projects = ["prj_site", "prj_book"];
  const polls = dk.ops("exec").length;
  await until(() => dk.ops("exec").length > polls + 5, "the run to read its screen a few more times");
  assert.equal(dk.ops("remove").filter((x) => x.name === NAME).length, 0, "the running container was not removed");
  assert.equal(dk.ops("create").filter((x) => x.name === NAME).length, 1);
  // the build ends
  const typed = dk.box(NAME).tmux.calls.find((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build"))!;
  const end = /(__VYRE_END_[0-9a-f]+__)/.exec(String(typed.at(-1)))![1];
  dk.box(NAME).tmux.write("vyre-trm_1", `built\n\n${end}:0`);
  const r = await build;
  assert.deepEqual([r.exitCode, r.output], [0, "built"], "the command ran to its end and its output came back");
  const next = await host.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.equal(next.exitCode, 0);
  assert.equal(dk.ops("create").filter((x) => x.name === NAME).length, 2, "made again with the new mount once quiet");
  assert.ok(dk.box(NAME).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_book:/home/agent/projects/prj_book:rw"));
  m.close();
});

test("a project change while a person runs a program in an attached tab (an editor, a server) waits until the pane is a shell again", async () => {
  let projects = ["prj_site"];
  let pane = "vim";
  const clock = { t: 1_000_000 };
  const dk = engine({ panes: () => pane });
  const m = manager(dk, { projectsOf: () => projects, now: () => clock.t });
  await m.ensure(AGENT);
  projects = ["prj_site", "prj_book"];
  assert.equal(await m.ensure(AGENT), "running", "vim is open: the mount waits");
  assert.equal(dk.ops("remove").filter((x) => x.name === NAME).length, 0);
  pane = "bash";
  assert.equal(await m.ensure(AGENT), "running", "looked at again only after a few seconds");
  clock.t += 6000;
  assert.equal(await m.ensure(AGENT), "created", "quiet now: made again with the new mount");
  assert.ok(dk.box(NAME).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_book:/home/agent/projects/prj_book:rw"));
  m.close();
});

test("a project change on a workspace that sleeps is applied when it wakes", async () => {
  let projects = ["prj_site"];
  const dk = engine({ panes: () => "vim" });
  const m = manager(dk, { projectsOf: () => projects });
  await m.ensure(AGENT);
  await m.sleep(AGENT);
  projects = ["prj_book"];
  assert.equal(await m.ensure(AGENT), "created");
  assert.ok(dk.box(NAME).config["HostConfig"]["Binds"].includes("vyre-wsproj-prj_book:/home/agent/projects/prj_book:rw"));
  m.close();
});

// ---- 5: two turns at once in one tab, and two helpers with one name -------------------------------------------------------------------------------------------

test("two turns of the same agent at once take turns in its tab: the second command is typed only after the first one ends", async () => {
  const { agent } = setup();
  const dk = engine();
  const m = manager(dk);
  bindHost(daemonHost(m));
  const warm = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  const tm = () => dk.box(NAME).tmux;
  const begins = () => tm().calls.filter((c) => c[1] === "send-keys" && c.includes("-l") && String(c.at(-1)).includes("__VYRE_BEG_")).length;
  const n0 = begins();
  const other: TermCtx = { ...agent, thread: "thr_second_chat" };
  const a = h["terminal.run"]!(agent, { command: "build", idempotencyKey: idem() });
  await until(() => begins() === n0 + 1, "the first command to be typed");
  const b = h["terminal.run"]!(other, { command: "echo hi", idempotencyKey: idem() });
  await new Promise((x) => setTimeout(x, 150));
  assert.equal(begins(), n0 + 1, "the second command waits: nothing was typed into the running build");
  const typed = tm().calls.filter((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")).at(-1)!;
  const end = /(__VYRE_END_[0-9a-f]+__)/.exec(String(typed.at(-1)))![1];
  tm().write(`vyre-${warm.terminalId}`, `built\n\n${end}:0`);
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual([ra.terminalId, ra.exitCode, ra.output], [warm.terminalId, 0, "built"]);
  assert.deepEqual([rb.terminalId, rb.exitCode, rb.output], [warm.terminalId, 0, "hi"]);
  m.close();
});

test("a command that waited its whole time for another one is not typed, interrupts nothing, and says why", async () => {
  const { agent } = setup();
  const dk = engine();
  const m = manager(dk);
  bindHost(daemonHost(m));
  const warm = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  const a = h["terminal.run"]!(agent, { command: "build", timeoutSec: 30, idempotencyKey: idem() });
  await until(() => dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")), "the build to be typed");
  let err: unknown;
  try { await h["terminal.run"]!(agent, { command: "echo hi", timeoutSec: 1, idempotencyKey: idem() }); } catch (e) { err = e; }
  assert.equal(codeOf(err), "timeout.deadline");
  assert.match((err as { error: { message: string } }).error.message, /busy with another command/);
  assert.equal(dk.box(NAME).tmux.calls.filter((c) => c[1] === "send-keys" && c.at(-1) === "C-c").length, 0, "the build was not interrupted");
  const typed = dk.box(NAME).tmux.calls.filter((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")).at(-1)!;
  dk.box(NAME).tmux.write(`vyre-${warm.terminalId}`, `\n${/(__VYRE_END_[0-9a-f]+__)/.exec(String(typed.at(-1)))![1]}:0`);
  assert.equal((await a).exitCode, 0);
  m.close();
});

const THREADS: Record<string, { kind: string; title?: string; parentThreadId?: string; agents: Array<{ agentId: string }> }> = {
  thr_lead: { kind: "chat", agents: [{ agentId: "agt_dex" }] },
  thr_h1: { kind: "helper", title: "Read the logs", parentThreadId: "thr_lead", agents: [{ agentId: "agt_dex" }] },
  thr_h2: { kind: "helper", title: "Read the logs", parentThreadId: "thr_lead", agents: [{ agentId: "agt_dex" }] },
  thr_s1: { kind: "helper", title: "one", parentThreadId: "thr_lead", agents: [{ agentId: "agt_scout1" }] },
  thr_s2: { kind: "helper", title: "two", parentThreadId: "thr_lead", agents: [{ agentId: "agt_scout2" }] },
};
const threadCalls = async (cap: string, input: unknown): Promise<unknown> => {
  if (cap === "threads.get") { const t = THREADS[(input as { threadId: string }).threadId]; return t ? { thread: { threadId: (input as { threadId: string }).threadId, ...t } } : undefined; }
  if (cap === "agents.get") return { agent: { agentId: (input as { agentId: string }).agentId, name: (input as { agentId: string }).agentId.startsWith("agt_scout") ? "Scout" : "Dex", ownerId: "usr_dana", kind: "teammate" } };
  throw new Error(`unexpected ${cap}`);
};

test("two helpers with one name each get a tab of their own: two helper chats of the agent with the same title, and two different agents both called Scout", async () => {
  reset();
  bindWorkspaces(true);
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  const as = (agentId: string, thread: string): TermCtx => ({ ...hn.as({ kind: "agent", id: agentId }, "usr_dana", "run_1"), thread, call: threadCalls as never });
  const h1 = await h["terminal.run"]!(as("agt_dex", "thr_h1"), { command: "echo hi", idempotencyKey: idem() });
  const h2 = await h["terminal.run"]!(as("agt_dex", "thr_h2"), { command: "echo hi", idempotencyKey: idem() });
  assert.notEqual(h1.terminalId, h2.terminalId, "the same title, two helpers: two tabs");
  const h1again = await h["terminal.run"]!(as("agt_dex", "thr_h1"), { command: "echo hi", idempotencyKey: idem() });
  assert.equal(h1again.terminalId, h1.terminalId, "a helper keeps its own tab");
  const s1 = await h["terminal.run"]!(as("agt_scout1", "thr_s1"), { command: "echo hi", idempotencyKey: idem() });
  const s2 = await h["terminal.run"]!(as("agt_scout2", "thr_s2"), { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual([s1.exitCode, s2.exitCode], [0, 0], "the second Scout runs too");
  assert.notEqual(s1.terminalId, s2.terminalId);
});

// ---- 10: terminal.status checks who may see the session ----------------------------------------------------------------------------------------------------

test("terminal.status tells nothing about a session in another person's Assistant's workspace", async () => {
  reset();
  bindWorkspaces(true);
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  const facts = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "agents.get") return { agent: { agentId: (input as { agentId: string }).agentId, ownerId: "usr_dana", kind: "assistant" } };
    if (cap === "threads.get") return undefined;
    throw new Error(`unexpected ${cap}`);
  };
  const asst: TermCtx = { ...hn.as({ kind: "agent", id: "agt_asst" }, "usr_dana", "run_1"), thread: "thr_a", call: facts as never };
  const r = await h["terminal.run"]!(asst, { command: "echo hi", idempotencyKey: idem() });
  const dana: TermCtx = { ...hn.as({ kind: "person", id: "usr_dana" }), call: facts as never };
  const eve: TermCtx = { ...hn.as({ kind: "person", id: "usr_eve" }), call: facts as never };
  assert.equal((await h["terminal.status"]!(dana, { terminalIds: [r.terminalId] })).rows.length, 1, "its person sees it");
  assert.deepEqual((await h["terminal.status"]!(eve, { terminalIds: [r.terminalId] })).rows, [], "another person, whatever their role, does not");
});
