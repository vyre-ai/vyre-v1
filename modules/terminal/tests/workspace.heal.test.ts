// An agent's terminal keeps working across what happens to its workspace on the way (12 Nov round): a daemon restart while the workspace sleeps or after tmux lost its sessions, a project change in the
// middle of a command, an idle sweep while a script or a background job runs, two turns of the same agent at once, two helpers with one name. The Docker engine is the stand-in (fixtures/fake-docker.ts)
// behind the real DockerApi, and the handlers run against the real host stack (createLocalHost over the workspace terminal host), so a restart is a new manager and a new host over the same engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import { createWorkspaceManager, createWorkspaceTerminalHost, workspaceContainerConfig, workspaceName, workspaceNetworkName } from "../workspace.ts";
import type { WorkspaceManager, WorkspaceOptions } from "../workspace.ts";
import { createLocalHost, handlers } from "../impl.ts";
import { bindHost, bindValues, bindWorkspaces } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";
import type { FakeDockerOptions } from "../fixtures/fake-docker.ts";
import { fakeTmux } from "../fixtures/fake-tmux.ts";
import { codeOf, fakeHost, fakeValues, harness, reset } from "../fixtures/harness.ts";

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
  // the build ends: it prints its end, and the shell has its prompt back (12 Nov, review 3: a run now waits for the prompt)
  tm().write(`vyre-${warm.terminalId}`, `built\n\n${end}:0`);
  tm().sessions.get(`vyre-${warm.terminalId}`)!.hung = false;
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

// ---- 13: an agent goes to Trash ------------------------------------------------------------------------------------------------------------------------------

test("an agent moved to Trash (or the Assistant of a person who left) loses its workspace: sessions close, the container and the room go, what it kept stays", async () => {
  const { hn, agent } = setup();
  const room: string[] = [];
  const dk = engine();
  const m = manager(dk, { capacity: { async claim(id) { room.push(`claim ${id}`); return { state: "running" }; }, async release(id) { room.push(`release ${id}`); } } });
  bindHost(daemonHost(m));
  const r = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  assert.equal(dk.box(NAME).running, true);
  const { consumers } = await import("../impl.ts");
  const gone = consumers["terminal.agent_gone"];
  assert.deepEqual(gone.on, ["agent.deleted"]);
  const closed = await onAgentGoneWith(m, hn.ctx, AGENT);
  assert.deepEqual(closed, [r.terminalId]);
  assert.equal(dk.boxes.has(NAME), false, "the container is gone");
  assert.equal(dk.ops("volume_remove").length, 0, "its home and Files volumes stay: an agent in Trash can be restored");
  assert.equal(room.at(-1), `release ${AGENT}`, "the room it held goes back");
  assert.equal(hn.rows("SELECT closed_at FROM terminal_sessions WHERE terminal_id = ?", r.terminalId)[0]?.["closed_at"] !== null, true, "its tab is closed");
  assert.equal(hn.named("terminal.closed").length, 1);
  assert.deepEqual(await onAgentGoneWith(m, hn.ctx, AGENT), [], "safe to run twice");
  m.close();
});

async function onAgentGoneWith(m: WorkspaceManager, ctx: TermCtx, agentId: string): Promise<string[]> {
  const { onAgentGone } = await import("../handlers/sessions.ts");
  return onAgentGone(ctx, { payload: { agentId } }, (id) => m.remove(id, { keepVolumes: true }));
}

// ---- 12: room held by a workspace that died outside Vyre ---------------------------------------------------------------------------------------------------

test("a workspace whose container stopped without Vyre (out of memory, docker stop, a reboot) gives its room back at the next sweep, in this process and after a restart", async () => {
  const room: string[] = [];
  const capacity = { async claim(id: string) { room.push(`claim ${id}`); return { state: "running" as const }; }, async release(id: string) { room.push(`release ${id}`); } };
  const dk = engine();
  const m = manager(dk, { capacity });
  await m.ensure(AGENT);
  dk.kill(NAME);
  await m.sweep();
  assert.deepEqual(room, [`claim ${AGENT}`, `release ${AGENT}`], "the dead container's room went back");
  assert.equal((await m.ensure(AGENT)), "woke", "the next use starts it again, asking for room again");
  assert.deepEqual(room.slice(-1), [`claim ${AGENT}`]);
  m.close();
  // the host reboots: the daemon starts again and the container is stopped
  dk.kill(NAME);
  const after = manager(dk, { capacity });
  room.length = 0;
  await after.sweep();
  assert.deepEqual(room, [`release ${AGENT}`], "after the restart its room goes back once");
  await after.sweep();
  assert.deepEqual(room, [`release ${AGENT}`], "and only once");
  after.close();
});

// ---- 8: who changed a project file -------------------------------------------------------------------------------------------------------------------------

test("a project file's change is put in Files history as the agent whose command made it, not as another agent whose tab only read its screen", async () => {
  const passes: Array<{ projectId: string; agentId: string }> = [];
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    projectManifest: (id) => `/m/p/${id}.json`,
    syncProject: (x) => ({ async pass() { passes.push({ projectId: x.projectId, agentId: x.agentId }); return { failed: 0 }; } }),
    intervalMs: 60_000,
  };
  const dk = engine();
  const m = manager(dk, { home, projectsOf: () => ["prj_site"], projectKickMs: 5, sleep: fast });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  const B = "agt_pam";
  await host.open({ terminalId: "trm_b", target: { host: "agent_computer", agentId: B }, name: "agent", cols: 80, rows: 24, folders: [] });
  await host.open({ terminalId: "trm_a", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  await host.run("trm_a", { command: "echo hi", env: {}, timeoutMs: 5000 });
  const n = passes.length;
  // B's tab is open: it reads its screen, resizes, asks its status, again and again, while A's change waits for its pass
  let cursor = (await host.read("trm_b", { lines: 50 })).next;
  for (let i = 0; i < 5; i++) { cursor = (await host.read("trm_b", { lines: 50, since: cursor })).next; await host.resize("trm_b", 90, 30); await host.status(["trm_b"]); }
  await new Promise((x) => setTimeout(x, 40));
  const after = passes.slice(n).filter((p) => p.projectId === "prj_site");
  assert.ok(after.length >= 1, "a pass followed A's command");
  assert.deepEqual([...new Set(after.map((p) => p.agentId))], [AGENT], `named as A, the agent that worked: ${JSON.stringify(after)}`);
  m.close();
});

// ---- 9: the waiting line --------------------------------------------------------------------------------------------------------------------------------

test("a workspace waiting for room says only what is true: the host it waits on, and that it starts by itself; never to add a compute server, which cannot take it", async () => {
  const dk = engine();
  const m = manager(dk, { capacity: { async claim() { return { state: "waiting", line: "Waiting for room on Maya's server. Add a compute server in Console > Computers to run more." }; }, async release() { /* nothing held */ } } });
  let message = "";
  try { await m.ensure(AGENT); } catch (e) { message = (e as Error).message; }
  assert.equal(message, "Waiting for room on Maya's server. The workspace starts by itself when there is room.");
  assert.deepEqual(await m.status(AGENT), { state: "waiting", line: message });
  const bare = manager(dk, { capacity: { async claim() { return { state: "waiting" }; }, async release() { /* nothing held */ } } });
  await assert.rejects(() => bare.ensure("agt_other"), (e: Error) => e.message === "Waiting for room on the Space server. The workspace starts by itself when there is room.");
  m.close();
  bare.close();
});

// ---- 16: an agent the caller cannot read ---------------------------------------------------------------------------------------------------------------

test("an admin whose agents.get of another person's Assistant answers not found is not let into its workspace by holding Manage", async () => {
  const { mayEnterWorkspace } = await import("../handlers/sessions.ts");
  reset();
  const hn = harness();
  const hidden = async (cap: string): Promise<unknown> => { if (cap === "agents.get") throw Object.assign(new Error("That agent does not exist."), { error: { code: "validation.not_found" } }); return undefined; };
  const admin: TermCtx = { ...hn.as({ kind: "person", id: "usr_admin" }), call: hidden as never, authorize: () => ({ effect: "allow" }) };
  assert.equal(await mayEnterWorkspace(admin, "agt_dana_assistant"), false);
  // a team agent the admin can read is still theirs to enter by Manage
  const team: TermCtx = { ...admin, call: (async (cap: string) => (cap === "agents.get" ? { agent: { agentId: "agt_dex", ownerId: "usr_dana", kind: "teammate" } } : undefined)) as never };
  assert.equal(await mayEnterWorkspace(team, "agt_dex"), true);
});

// ---- review 1: leaving a project takes effect at once ------------------------------------------------------------------------------------------------------

test("an agent taken off a project loses its folder at once, even with work running: the workspace is made again without it, the project's mirror stops naming it, and the cut-off command says why", async () => {
  let projects = ["prj_site", "prj_secret"];
  const passes: Array<{ projectId: string; agentId: string }> = [];
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    syncProject: (x) => ({ async pass() { passes.push({ projectId: x.projectId, agentId: x.agentId }); return { failed: 0 }; } }),
    intervalMs: 60_000,
  };
  // a job in the background and a held run: the workspace is as busy as it gets
  const dk = engine({ procs: () => "4711" });
  const m = manager(dk, { projectsOf: () => projects, home, projectKickMs: 5, sleep: fast });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_r", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  const build = host.run("trm_r", { command: "build", env: {}, timeoutMs: 20_000 });
  await until(() => dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")), "the build to be typed");
  projects = ["prj_site"];
  await m.revoke(AGENT);
  assert.equal(dk.ops("create").filter((x) => x.name === NAME).length, 2, "made again at once, though it was busy");
  const binds = dk.box(NAME).config["HostConfig"]["Binds"] as string[];
  assert.ok(!binds.some((b) => b.includes("prj_secret")), `no prj_secret mount: ${JSON.stringify(binds)}`);
  assert.ok(binds.some((b) => b.includes("prj_site")), "the project it is still on stays");
  await assert.rejects(() => build, (e: Error) => /removed from a project/.test(e.message), "the cut-off command says why");
  const n = passes.length;
  m.worked(AGENT);
  await new Promise((x) => setTimeout(x, 40));
  assert.deepEqual(passes.slice(n).filter((p) => p.projectId === "prj_secret"), [], "the left project is no longer mirrored through this agent");
  m.close();
});

// ---- review 2: a deleted agent stays without a workspace ---------------------------------------------------------------------------------------------------

test("an agent deleted while a command of its runs: the command ends with a plain line, and nothing makes the workspace again or takes room for it until it is restored", async () => {
  const room: string[] = [];
  const dk = engine();
  const m = manager(dk, { sleep: fast, capacity: { async claim(id) { room.push(`claim ${id}`); return { state: "running" }; }, async release(id) { room.push(`release ${id}`); } } });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_d", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  const build = host.run("trm_d", { command: "build", env: {}, timeoutMs: 20_000 });
  await until(() => dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")), "the build to be typed");
  const { onAgentGone } = await import("../handlers/sessions.ts");
  reset();
  const hn = harness();
  await onAgentGone(hn.ctx, { payload: { agentId: AGENT } }, (id) => m.remove(id, { keepVolumes: true }));
  await assert.rejects(() => build, (e: Error) => /in Trash/.test(e.message), "the running command ends with the plain line");
  await new Promise((x) => setTimeout(x, 100));
  assert.equal(dk.boxes.has(NAME), false, "the container was not made again by the command's screen reads");
  assert.equal(room.filter((x) => x === `claim ${AGENT}`).length, 1, "no room was taken again");
  await assert.rejects(() => m.ensure(AGENT), /in Trash/);
  await assert.rejects(() => m.exec(AGENT, ["tmux", "-V"]), /in Trash/);
  await assert.rejects(() => m.provision(AGENT), /in Trash/);
  m.restore(AGENT);
  assert.equal(await m.ensure(AGENT), "created", "restored: made again over the volumes it kept");
  m.close();
});

// ---- review 4: a rebuild keeps its room against the sweep ---------------------------------------------------------------------------------------------------

test("a sweep that runs while a project change is rebuilding the workspace (its container stopped for a moment) does not give its room away", async () => {
  const room: string[] = [];
  let projects = ["prj_site"];
  const dk = engine();
  // the rebuild's stop is held open until the test lets it go: the sweep runs exactly then
  let hold: (() => void) | null = null;
  let stopped: (() => void) | null = null;
  const stoppedP = new Promise<void>((r) => { stopped = r; });
  const http: typeof dk.http = async (req) => {
    const r = await dk.http(req);
    if (req.method === "POST" && req.path === `/containers/${NAME}/stop` && projects.length === 2) { stopped!(); await new Promise<void>((x) => { hold = x; }); }
    return r;
  };
  const m = createWorkspaceManager({ api: createDockerApi(http), http, idleMs: 600_000, projectsOf: () => projects, capacity: { async claim(id) { room.push(`claim ${id}`); return { state: "running" }; }, async release(id) { room.push(`release ${id}`); } } });
  await m.ensure(AGENT);
  projects = ["prj_site", "prj_book"];
  const rebuild = m.ensure(AGENT);
  await stoppedP;
  assert.equal(dk.box(NAME).running, false, "the container is stopped mid-rebuild");
  const sweep = m.sweep();
  await new Promise((x) => setTimeout(x, 20));
  hold!();
  await rebuild;
  await sweep;
  assert.deepEqual(room.filter((x) => x.startsWith("release")), [], `no room given back during the rebuild: ${JSON.stringify(room)}`);
  assert.equal(dk.box(NAME).running, true);
  m.close();
});

// ---- review 5: room after a restart --------------------------------------------------------------------------------------------------------------------------

test("after a restart a workspace waiting in the host's queue keeps its place, and one that was already running holds room, given back if it then dies outside Vyre", async () => {
  const room: string[] = [];
  const queue = new Set<string>(["agt_waits"]);
  const capacity = {
    async claim(id: string) { room.push(`claim ${id}`); return { state: "running" as const }; },
    async release(id: string) { room.push(`release ${id}`); queue.delete(id); },
    async waiting(id: string) { return queue.has(id) ? "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." : null; },
  };
  const dk = engine();
  const before = manager(dk, { capacity });
  await before.ensure(AGENT);
  await before.provision("agt_waits");
  before.close();
  // the daemon restarts: one workspace runs, the other is stopped and waits in the queue the database keeps
  const after = manager(dk, { capacity });
  room.length = 0;
  await after.sweep();
  assert.deepEqual(room, [], "the waiting place is kept, and the running workspace's room is not touched");
  assert.deepEqual(await after.status("agt_waits"), { state: "waiting", line: "Waiting for room on the Space server. The workspace starts by itself when there is room." }, "and still says it waits");
  // the running one dies outside Vyre (out of memory): its room goes back at the next sweep
  dk.kill(NAME);
  await after.sweep();
  assert.deepEqual(room, [`release ${AGENT}`]);
  after.close();
});

// ---- review 6: running work keeps a workspace awake for at most 12 hours ---------------------------------------------------------------------------------------

test("a job left running keeps the workspace awake, says so in its status line, and for at most 12 hours after the last command or keystroke; then it sleeps and the next command says why, once", async () => {
  const clock = { t: 1_000_000 };
  const dk = engine({ procs: () => "4711 tail -f app.log" });
  const m = manager(dk, { now: () => clock.t, sleep: fast });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_c", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  await host.run("trm_c", { command: "echo hi", env: {}, timeoutMs: 5000 });
  for (let h = 0; h < 11; h++) { clock.t += 60 * 60_000; await m.sweep(); }
  assert.equal(dk.box(NAME).running, true, "11 hours on: still awake, the job runs");
  assert.deepEqual(await m.status(AGENT), { state: "running", line: "running: tail -f app.log" }, "and the status line says why");
  clock.t += 61 * 60_000;
  assert.deepEqual(await m.sweep(), [AGENT], "past 12 hours with no command or keystroke: it sleeps anyway");
  const woke = await host.run("trm_c", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.match(woke.output, /^The workspace went to sleep after 12 hours with no command or keystroke, though it was still running tail -f app\.log\./);
  assert.match(woke.output, /\nhi$/);
  const again = await host.run("trm_c", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.equal(again.output, "hi", "said once");
  m.close();
});

// ---- review 7 ---------------------------------------------------------------------------------------------------------------------------------------------

test("review 7: a status read never makes a session; one the person ended with exit reads as exited, here and after a restart, and the next command makes it again", async () => {
  reset();
  const hn = harness();
  const local = fakeTmux({ scripts: { "echo hi": { out: "hi", code: 0 } } });
  const seam = { exec: local.exec, shell: async () => ({ exitCode: 0 }), home: "/home/person", runsHere: () => true };
  bindHost(createLocalHost(seam));
  const t = await h["terminal.open"]!(hn.ctx, { host: "device", deviceId: "dev_mac", idempotencyKey: idem() });
  local.sessions.delete(`vyre-${t.terminal.terminalId}`);   // the person typed exit
  bindHost(createLocalHost(seam));   // a restart
  const made = (): number => local.calls.filter((c) => c[1] === "new-session").length;
  const n0 = made();
  assert.equal((await h["terminal.status"]!(hn.ctx, { terminalIds: [t.terminal.terminalId] })).rows[0].state, "exited");
  assert.equal(made(), n0, "the status read made nothing");
  const r = await h["terminal.run"]!(hn.ctx, { command: "echo hi", terminalId: t.terminal.terminalId, host: "device", idempotencyKey: idem() });
  assert.equal(r.output, "hi", "a command makes it again");

  // a workspace session ended with exit, in the container it lived in: exited; after the workspace slept and woke: idle, made again on use
  const dk = engine();
  const m = manager(dk);
  const wh = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await wh.open({ terminalId: "trm_x", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  dk.box(NAME).tmux.sessions.delete("vyre-trm_x");
  assert.equal((await wh.status(["trm_x"]))[0]!.state, "exited");
  await m.sleep(AGENT);
  await m.ensure(AGENT);
  assert.equal((await wh.status(["trm_x"]))[0]!.state, "idle");
  m.close();
});

test("review 7: status asks agents.get once per agent per poll, and an agent that cannot be read just now keeps its row instead of vanishing; only not found refuses entry", async () => {
  reset();
  bindWorkspaces(true);
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  const agentCtx: TermCtx = { ...hn.as({ kind: "agent", id: "agt_dex" }, "usr_dana", "run_1"), thread: "thr_a" };
  const ids: string[] = [];
  for (const session of ["a", "b", "c"]) ids.push((await h["terminal.run"]!(agentCtx, { command: "echo hi", session, idempotencyKey: idem() })).terminalId);
  let asks = 0;
  let broken = false;
  const call = async (cap: string): Promise<unknown> => {
    if (cap !== "agents.get") return undefined;
    asks += 1;
    if (broken) throw Object.assign(new Error("agents did not answer"), { error: { code: "internal.unexpected" } });
    return { agent: { agentId: "agt_dex", ownerId: "usr_dana", kind: "teammate" } };
  };
  const dana: TermCtx = { ...hn.as({ kind: "person", id: "usr_dana" }), call: call as never };
  assert.equal((await h["terminal.status"]!(dana, { terminalIds: ids })).rows.length, 3);
  assert.equal(asks, 1, "one agents.get for three tabs of one agent");
  broken = true;
  const kept = (await h["terminal.status"]!(dana, { terminalIds: ids })).rows as Array<{ terminalId: string }>;
  assert.deepEqual(kept.map((r) => r.terminalId), ids, "the rows stay, as last recorded");
  let err: unknown;
  try { await h["terminal.read"]!(dana, { terminalId: ids[0], lines: 5 }); } catch (e) { err = e; }
  assert.equal(codeOf(err), "internal.unavailable", "any other failure is unavailable, not a refusal");
});

test("review 7: a command queued behind another whose tab is closed before its turn says so and is never typed", async () => {
  const { agent } = setup();
  const dk = engine();
  const m = manager(dk);
  bindHost(daemonHost(m));
  const warm = await h["terminal.run"]!(agent, { command: "echo hi", idempotencyKey: idem() });
  const a = h["terminal.run"]!(agent, { command: "build", idempotencyKey: idem() });
  await until(() => dk.box(NAME).tmux.calls.some((c) => c[1] === "send-keys" && String(c.at(-1)).includes("build")), "the build to be typed");
  let err: unknown;
  const b = h["terminal.run"]!(agent, { command: "echo queued", idempotencyKey: idem() }).catch((e: unknown) => { err = e; });
  await new Promise((x) => setTimeout(x, 50));
  await h["terminal.close"]!(agent, { terminalId: warm.terminalId });
  await a.catch(() => undefined);
  await b;
  assert.match((err as { error?: { message?: string } }).error?.message ?? "", /closed before this command's turn came/);
  assert.equal(dk.box(NAME).tmux.calls.some((c) => String(c.at(-1)).includes("echo queued")), false, "never typed");
  m.close();
});

// ---- lead, 12 Nov: the volumes of an agent in Trash go after the Space's Trash retention ------------------------------------------------------------------

test("an agent in Trash keeps its workspace volumes for the Space's Trash retention, read from governance at run time; restoring it stops the clock; then the periodic pass removes them", async () => {
  const { onAgentGone, onAgentRestored, forgetExpiredWorkspaces } = await import("../handlers/sessions.ts");
  reset();
  const hn = harness();
  let retention = "7d";
  const removed: string[] = [];
  const ctx: TermCtx = { ...hn.ctx, call: (async (cap: string) => (cap === "governance.retention.get" ? { kinds: [{ key: "trash", value: retention }] } : undefined)) as never };
  const remove = async (id: string): Promise<void> => { removed.push(id); };
  await onAgentGone(ctx, { payload: { agentId: "agt_old" } }, null);
  await onAgentGone(ctx, { payload: { agentId: "agt_back" } }, null);
  hn.advance(6 * 86_400_000);
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, remove), [], "six days in Trash: kept");
  assert.equal(onAgentRestored(ctx, "agt_back"), true);
  hn.advance(2 * 86_400_000);
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, remove), ["agt_old"], "past the retention: its volumes go; the restored agent's stay");
  assert.deepEqual(removed, ["agt_old"]);
  // Trash kept forever: nothing goes; governance not reachable: its 30-day default
  await onAgentGone(ctx, { payload: { agentId: "agt_kept" } }, null);
  retention = "forever";
  hn.advance(400 * 86_400_000);
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, remove), []);
  const noGov: TermCtx = { ...hn.ctx, call: (async () => { throw new Error("governance is not here"); }) as never };
  assert.deepEqual(await forgetExpiredWorkspaces(noGov, remove), ["agt_kept"]);
});

// ---- lead, 12 Nov: the workspaces' subnets are known to the daemon's guard -----------------------------------------------------------------------------------

test("the terminal module registers the subnets its workspaces are on, for the daemon's guard: the shared network on a socket, each workspace's own behind the runner, after a restart too", async () => {
  const dk = engine();
  const m = manager(dk);
  assert.deepEqual(m.subnets(), [], "no workspace yet, no network");
  await m.ensure(AGENT);
  assert.deepEqual(m.subnets(), ["172.31.0.0/24"], "the shared network's subnet");
  // behind the runner the same shared network (12 Nov), read by its name
  const runner = manager(dk, { runner: true });
  await runner.ensure("agt_pam");
  assert.deepEqual(runner.subnets(), ["172.31.0.0/24"], "behind the runner, the shared network");
  runner.close();
  const restarted = manager(dk, { runner: true });
  await restarted.sweep();
  assert.deepEqual(restarted.subnets(), ["172.31.0.0/24"], "read again by name after a restart");
  const { agentSubnets } = await import("../impl.ts");
  assert.equal(typeof agentSubnets, "function", "exported as the registry asks (agentSubnets)");
  m.close(); restarted.close();
});

// ---- second look S1: a shared network that cannot be had never takes a working workspace away ------------------------------------------------------------------

test("S1: a workspace made before the shared network keeps working while the network cannot be made (pools used up), moves when it can, and a network of that name that is not ours is never used", async () => {
  let fails = true;
  const logs: string[] = [];
  const clock = { t: 1_000_000 };
  const dk = engine({ networkFails: () => fails });
  // made before 12 Nov: on Docker's default bridge, with the label of that time
  const old = workspaceContainerConfig(AGENT, "vyre/agent-workspace:1", { projects: [] }, {}, "bridge");
  await dk.http({ method: "POST", path: "/containers/create", query: { name: NAME }, json: old });
  await dk.http({ method: "POST", path: `/containers/${NAME}/start` });
  const m = manager(dk, { now: () => clock.t, log: (_l, msg) => { logs.push(msg); } });
  assert.equal((await m.exec(AGENT, ["tmux", "-V"])).code, 0, "it still works");
  assert.equal(dk.ops("remove").filter((x) => x.name === NAME).length, 0, "and was not taken away");
  assert.ok(logs.includes("workspace.network_fallback"));
  // a new workspace is made on the bridge too, rather than refused
  assert.equal(await m.ensure("agt_new"), "created");
  assert.equal(dk.box(workspaceName("agt_new")).config["HostConfig"]["NetworkMode"], "bridge");
  // the pools free up: the next quiet wake after the minute's wait (third look T3) moves it to the shared network
  fails = false;
  clock.t += 61_000;
  await m.ensure(AGENT);
  assert.equal(dk.box(NAME).config["HostConfig"]["NetworkMode"], "vyre-workspaces", "moved once the network could be made");
  m.close();

  // a network called vyre-workspaces that is not Vyre's, or lets containers reach each other, is not used
  const dk2 = engine();
  await dk2.http({ method: "POST", path: "/networks/create", json: { Name: "vyre-workspaces", Driver: "bridge" } });
  const logs2: string[] = [];
  const m2 = manager(dk2, { log: (_l, msg) => { logs2.push(msg); } });
  await m2.ensure(AGENT);
  assert.equal(dk2.box(NAME).config["HostConfig"]["NetworkMode"], "bridge", "kept off a network whose isolation is unknown");
  assert.ok(logs2.includes("workspace.network_not_ours"));
  m2.close();
});

// ---- second look S2 and S3 -------------------------------------------------------------------------------------------------------------------------------------

test("S3: a command with a Vault value right behind another in the same tab runs (the tab is idle before the next turn starts), and a status poll does not rewrite a row while a run is in flight", async () => {
  reset();
  bindWorkspaces(true);
  const hn = harness();
  let release: (() => void) | null = null;
  const host = fakeHost({
    "npm test": () => new Promise((r) => { release = () => r({ exitCode: 0, output: "ok" }); }),
    "deploy": { exitCode: 0, output: "deployed" },
  });
  // tmux reads a builtin loop as the idle shell: the host's status says idle while the run goes on
  bindHost({ ...host.host, status: async (ids) => ids.map((terminalId) => ({ terminalId, state: "idle" as const, exitCode: null })) });
  bindValues(fakeValues({ "#GH.token": "gh-token-0123456789" }));
  const agent: TermCtx = { ...hn.as({ kind: "agent", id: AGENT }, "usr_dana", "run_1"), thread: "thr_s3" };
  const first = h["terminal.run"]!(agent, { command: "npm test", session: "ci", idempotencyKey: idem() });
  await until(() => release !== null, "npm test to run");
  const second = h["terminal.run"]!(agent, { command: "deploy", env: { TOKEN: "#GH.token" }, session: "ci", idempotencyKey: idem() });
  // a status poll while npm test runs: the host says idle (tmux sees the shell), the row stays running
  const id = (hn.rows("SELECT terminal_id FROM terminal_sessions WHERE name = 'ci'")[0] as { terminal_id: string }).terminal_id;
  await h["terminal.status"]!(hn.ctx, { terminalIds: [id] });
  assert.equal((hn.rows("SELECT state FROM terminal_sessions WHERE terminal_id = ?", id)[0] as { state: string }).state, "running", "a poll does not mark it idle under a run in flight");
  release!();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.output, b.output], ["ok", "deployed"], "the second, with its value, ran right after");
});

test("S2: a deleted agent's remembered Vault values leave memory with it", async () => {
  const { onAgentGone } = await import("../handlers/sessions.ts");
  const { rememberSecrets, scrubberFor } = await import("../projections.ts");
  reset();
  const hn = harness();
  rememberSecrets(`ws:${AGENT}`, [{ handle: "#GH.token", itemId: "vit_x", value: "gh-token-0123456789" }]);
  assert.notEqual(scrubberFor(`ws:${AGENT}`), null);
  await onAgentGone(hn.ctx, { payload: { agentId: AGENT } }, null);
  assert.equal(scrubberFor(`ws:${AGENT}`), null);
});

// ---- in force at return: leaving a project, before the removal answers ---------------------------------------------------------------------------------------

test("cut: the removal's own call stops the project's mirror for the agent and stops the running workspace at once; the next use makes it again without the folder, even while the projects list still names it", async () => {
  let projects = ["prj_site", "prj_secret"];
  const dk = engine({ procs: () => "4711 sleep 999999" });
  const m = manager(dk, { projectsOf: () => projects, sleep: fast });
  await m.ensure(AGENT);
  const stops = dk.ops("stop").length;
  await m.cut(AGENT, "prj_secret");
  assert.equal(dk.box(NAME).running, false, "stopped at once, though busy");
  assert.equal(dk.ops("stop").length, stops + 1);
  // the projects list has not caught up yet: the folder still stays out
  await m.ensure(AGENT);
  assert.ok(!(dk.box(NAME).config["HostConfig"]["Binds"] as string[]).some((b) => b.includes("prj_secret")), "made again without the folder");
  projects = ["prj_site"];
  assert.equal(await m.ensure(AGENT), "running", "and nothing more to do once the list agrees");
  m.close();
});

// ---- a Personal Space with no computer to run a workspace on now ---------------------------------------------------------------------------------------------

test("a Personal Space (its kind bound as the daemon binds it) with no computer that can run workspaces now is told why and what fixes it, not that it needs a Team Space", async () => {
  const { bindTeam } = await import("../projections.ts");
  reset();
  bindTeam(() => false);   // as host/src/daemon/module-ports.ts binds a Personal Space's kind (lane f-wire)
  bindWorkspaces(false);
  const hn = harness();
  bindHost(fakeHost().host);
  let err: unknown;
  try { await h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_dana_assistant", idempotencyKey: idem() }); } catch (e) { err = e; }
  assert.equal(codeOf(err), "provider.unavailable");
  const message = (err as { error: { message: string } }).error.message;
  assert.equal(message, "No computer can run this agent's commands right now. Turn on the computer it runs on, or add a computer with Docker in Settings, Computer.");
  assert.doesNotMatch(message, /Team Space|machine/);
  // with the agent's name when the caller may read it; and a call that names no agent is told that first
  const named: TermCtx = { ...hn.ctx, call: (async (cap: string) => (cap === "agents.get" ? { agent: { name: "Desk", ownerId: "usr_dana" } } : undefined)) as never };
  try { await h["terminal.open"]!(named, { host: "agent_computer", agentId: "agt_desk", idempotencyKey: idem() }); } catch (e) { err = e; }
  assert.equal((err as { error: { message: string } }).error.message, "No computer can run Desk's commands right now. Turn on the computer it runs on, or add a computer with Docker in Settings, Computer.");
  try { await h["terminal.open"]!(hn.ctx, { host: "agent_computer", idempotencyKey: idem() }); } catch (e) { err = e; }
  assert.equal(codeOf(err), "validation.bad_input");
});

// ---- two daemons on one Docker engine ---------------------------------------------------------------------------------------------------------------------

test("two daemons on one Docker engine each sleep, list and give back the room of their own Space's workspaces only, a workspace made before the Space label included", async () => {
  const clock = { t: 1_000_000 };
  const dk = engine();
  const roomA: string[] = [], roomB: string[] = [];
  const cap = (log: string[]) => ({ async claim(id: string) { log.push(`claim ${id}`); return { state: "running" as const }; }, async release(id: string) { log.push(`release ${id}`); } });
  // a workspace of Space A made before the Space label
  const legacy = workspaceContainerConfig("agt_old_a", "vyre/agent-workspace:1", { projects: [] }, {}, "bridge");
  await dk.http({ method: "POST", path: "/containers/create", query: { name: workspaceName("agt_old_a") }, json: legacy });
  const a = manager(dk, { now: () => clock.t, owner: "spc_a", capacity: cap(roomA), ownsAgent: (id) => id.endsWith("_a") });
  const b = manager(dk, { now: () => clock.t, owner: "spc_b", capacity: cap(roomB), ownsAgent: (id) => id.endsWith("_b") });
  await a.ensure("agt_one_a");
  await b.ensure("agt_one_b");
  assert.deepEqual((await b.list()).map((x) => x.agentId).sort(), ["agt_one_b"], "B sees only its own");
  assert.deepEqual((await a.list()).map((x) => x.agentId).sort(), ["agt_old_a", "agt_one_a"], "A sees its own, the unlabelled one of its agent too");
  clock.t += 700_000;
  assert.deepEqual(await b.sweep(), ["agt_one_b"], "B sleeps only its own idle workspace");
  assert.equal(dk.box(workspaceName("agt_one_a")).running, true, "A's is untouched");
  assert.deepEqual(roomB.filter((x) => x.startsWith("release")), ["release agt_one_b"], "and gives back only its own room (A's stopped legacy workspace is not B's to release)");
  assert.deepEqual(await a.sweep(), ["agt_one_a"]);
  a.close(); b.close();
});

// ---- 12 Nov: room on a full host -----------------------------------------------------------------------------------------------------------------------------

test("a full host puts its longest-quiet workspace to sleep and starts the newcomer at once; only when every awake one is busy does the newcomer wait with the plain line", async () => {
  const clock = { t: 1_000_000 };
  const busyBoxes = new Set<string>();
  const dk = engine({ procs: (box) => (busyBoxes.has(box) ? "4711 npm run dev" : "") });
  const slots = new Set<string>();
  const capacity = {
    async claim(id: string) { if (slots.has(id) || slots.size < 2) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
    async release(id: string) { slots.delete(id); },
  };
  const m = manager(dk, { now: () => clock.t, capacity });
  await m.exec("agt_first", ["tmux", "-V"]);
  clock.t += 60_000;
  await m.exec("agt_second", ["tmux", "-V"]);
  clock.t += 60_000;
  assert.equal(await m.ensure("agt_third"), "created", "started at once");
  assert.equal(dk.box(workspaceName("agt_first")).running, false, "the longest-quiet one slept for it");
  assert.equal(dk.box(workspaceName("agt_second")).running, true);
  // now both awake ones are busy: the next one waits
  busyBoxes.add(workspaceName("agt_second")); busyBoxes.add(workspaceName("agt_third"));
  await assert.rejects(() => m.ensure("agt_fourth"), (e: Error) => /^Waiting for room on the Space server\. The workspace starts by itself when there is room\.$/.test(e.message));
  assert.equal(dk.box(workspaceName("agt_second")).running, true, "busy work is never put to sleep for room");
  assert.equal(dk.box(workspaceName("agt_third")).running, true);
  m.close();
});

// ---- 12 Nov: an awake workspace costs next to nothing while nothing happens ----------------------------------------------------------------------------------------

test("the Files mirror slows down while nothing happens in a workspace (each quiet pass waits twice as long, up to its most) and comes back at once with a command", async () => {
  const at: number[] = [];
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { at.push(Date.now()); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    intervalMs: 10,
  };
  const dk = engine();
  const m = manager(dk, { home, mirrorMaxMs: 160, now: () => Date.now() - 10 * 60_000 });   // the clock says nobody worked in the last minute
  await m.ensure(AGENT);
  const t0 = Date.now();
  await new Promise((x) => setTimeout(x, 600));
  const quiet = at.filter((x) => x >= t0).length;
  assert.ok(quiet <= 9, `at most a handful of passes in 600 ms while quiet (10, 20, 40, 80, 160, 160 ...), not 60: ${quiet}`);
  m.close();

  // working: every 10 ms; a command after a quiet spell brings the next pass at once
  const at2: number[] = [];
  const home2 = { ...home, sync: () => ({ async pass() { at2.push(Date.now()); return { failed: 0 }; } }) };
  const dk2 = engine();
  let fake = Date.now() - 10 * 60_000;
  const m2 = manager(dk2, { home: home2, mirrorMaxMs: 400, now: () => fake });
  await m2.ensure(AGENT);
  await new Promise((x) => setTimeout(x, 500));   // it has slowed to its most
  fake = Date.now();
  await m2.exec(AGENT, ["tmux", "-V"]);
  const t1 = Date.now();
  await new Promise((x) => setTimeout(x, 60));
  assert.ok(at2.some((x) => x >= t1 && x - t1 < 60), "a pass within a few ms of the command, not after the long wait");
  m2.close();
});

test("many newcomers at once on a full host each get room: one taking another's freed room makes room again", async () => {
  const dk = engine();
  const slots = new Set<string>();
  const capacity = {
    async claim(id: string) { if (slots.has(id) || slots.size < 4) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
    async release(id: string) { slots.delete(id); },
  };
  const clock = { t: 3_000_000 };
  const m = manager(dk, { capacity, now: () => clock.t });
  for (const id of ["agt_q0", "agt_q1", "agt_q2", "agt_q3"]) await m.exec(id, ["tmux", "-V"]);
  clock.t += 120_000;   // quiet for longer than the 90 s making room waits
  const outcomes = await Promise.allSettled(["agt_n0", "agt_n1", "agt_n2", "agt_n3"].map((id) => m.ensure(id)));
  assert.deepEqual(outcomes.map((x) => x.status), ["fulfilled", "fulfilled", "fulfilled", "fulfilled"], JSON.stringify(outcomes.map((x) => (x.status === "rejected" ? String((x.reason as Error).message) : "ok"))));
  m.close();
});

test("twenty newcomers at once on a full host all start: none puts another newcomer to sleep, and ones already put to sleep are passed over", async () => {
  const clock = { t: 5_000_000 };
  const dk = engine();
  const slots = new Set<string>();
  const capacity = {
    async claim(id: string) { if (slots.has(id) || slots.size < 20) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
    async release(id: string) { slots.delete(id); },
  };
  const m = manager(dk, { capacity, now: () => clock.t });
  const old = Array.from({ length: 20 }, (_, i) => `agt_old${i}`);
  for (const id of old) await m.exec(id, ["tmux", "-V"]);
  clock.t += 120_000;
  const fresh = Array.from({ length: 20 }, (_, i) => `agt_new${i}`);
  const outcomes = await Promise.allSettled(fresh.map((id) => m.ensure(id)));
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 20, JSON.stringify(outcomes.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason))));
  for (const id of fresh) assert.equal(dk.box(workspaceName(id)).running, true, `${id} awake`);
  for (const id of old) assert.equal(dk.box(workspaceName(id)).running, false, `${id} slept for room`);
  m.close();
});

test("pools used up by old networks of one workspace: the module removes one that only a sleeping workspace of its own used, makes the shared network, and that workspace wakes on it", async () => {
  let creates = 0;
  let full = false;
  const dk = engine({ networkFails: () => full && creates++ === 0 });   // the first try at the shared network finds the pools full
  const OLD = "agt_sleeper";
  const oldNet = workspaceNetworkName(OLD);
  // a workspace made before 12 Nov behind the runner: its own network, asleep
  await dk.http({ method: "POST", path: "/networks/create", json: { Name: oldNet, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": OLD } } });
  await dk.http({ method: "POST", path: "/containers/create", query: { name: workspaceName(OLD) }, json: workspaceContainerConfig(OLD, "vyre/agent-workspace:1", { projects: [] }, {}, oldNet) });
  full = true;
  const logs: string[] = [];
  const m = manager(dk, { log: (_l, msg) => { logs.push(msg); } });
  assert.equal(await m.ensure("agt_new"), "created");
  assert.equal(dk.box(workspaceName("agt_new")).config["HostConfig"]["NetworkMode"], "vyre-workspaces", "on the shared network after the pools were freed");
  assert.ok(logs.includes("workspace.old_network_removed"), "an old network was removed for room");
  assert.equal((await dk.http({ method: "GET", path: `/networks/${oldNet}` })).status, 404, "the sleeper's old network is gone");
  // the sleeper wakes on the shared network
  assert.equal((await m.exec(OLD, ["tmux", "-V"])).code, 0);
  assert.equal(dk.box(workspaceName(OLD)).config["HostConfig"]["NetworkMode"], "vyre-workspaces");
  m.close();
});

// ---- third look T1, T2, nit: Trash volumes ---------------------------------------------------------------------------------------------------------------------

test("T1: the Trash pass removes the volumes through the fleet although the agent.deleted cleanup already removed the container; a machine that does not answer keeps the row for the next pass", async () => {
  const { createWorkspaceFleet } = await import("../fleet.ts");
  const dk = engine();
  const space = manager(dk);
  const fleet = createWorkspaceFleet({ space, node: () => { throw new Error("no servers"); }, place: async () => null });
  await fleet.ensure(AGENT);
  const removedVols = (): string[] => dk.ops("volume_remove").map((x) => x.name as string);
  await fleet.remove(AGENT, { keepVolumes: true });   // agent.deleted
  assert.equal(dk.boxes.has(NAME), false);
  assert.deepEqual(removedVols(), [], "kept while in Trash");
  await fleet.remove(AGENT);   // the pass, past the retention: no container anywhere now
  assert.deepEqual(removedVols().sort(), [`${NAME}-files`, `${NAME}-home`], "both volumes removed");
  fleet.close();
  // a server that holds workspaces and does not answer: the removal throws, so the pass keeps the row
  const down = createWorkspaceFleet({ space: manager(engine()), node: () => ({ ...manager(engine()), remove: async () => { throw new Error("the server did not answer"); } }) as WorkspaceManager, place: async () => "nod_1" });
  await down.ensure("agt_far").catch(() => undefined);
  await assert.rejects(() => down.remove("agt_far"), /did not answer/);
  down.close();
});

test("T2: an agent that is not in Trash never loses its volumes and is never marked gone, in either order (pass before the restore consumer; a retried delete after the restore)", async () => {
  const { onAgentGone, forgetExpiredWorkspaces } = await import("../handlers/sessions.ts");
  reset();
  const hn = harness();
  const ctx: TermCtx = { ...hn.ctx, call: (async (cap: string) => (cap === "governance.retention.get" ? { kinds: [{ key: "trash", value: "7d" }] } : undefined)) as never };
  const trash = new Set<string>(["agt_back"]);
  const inTrash = (id: string): boolean => trash.has(id);
  const removed: string[] = [];
  const remove = async (id: string): Promise<void> => { removed.push(id); };
  // (a) deleted, restored near the end; the pass runs before agent.restored is consumed
  await onAgentGone(ctx, { payload: { agentId: "agt_back" } }, null, inTrash);
  hn.advance(8 * 86_400_000);
  trash.delete("agt_back");   // restored in the agents table; the terminal's consumer has not run yet
  assert.deepEqual(await forgetExpiredWorkspaces(ctx, remove, inTrash), [], "not removed");
  assert.deepEqual(removed, []);
  assert.equal((hn.ctx.db.all("SELECT 1 FROM terminal_workspace_gone WHERE agent_id = 'agt_back'") as unknown[]).length, 0, "and its row is let go");
  // (b) agent.deleted delivered (retried) after the restore: it is not in Trash, so nothing is closed, removed or marked
  const gone: string[] = [];
  assert.deepEqual(await onAgentGone(ctx, { payload: { agentId: "agt_back" } }, async (id) => { gone.push(id); }, inTrash), []);
  assert.deepEqual(gone, [], "its workspace is not removed");
  assert.equal((hn.ctx.db.all("SELECT 1 FROM terminal_workspace_gone WHERE agent_id = 'agt_back'") as unknown[]).length, 0, "no Trash clock");
});

test("nit: a Trash retention under one day counts as governance's default, never as remove at once", async () => {
  const { trashKeepMs, TRASH_KEEP_MS } = await import("../handlers/sessions.ts");
  reset();
  const hn = harness();
  for (const v of ["0d", "0w", "0m", "0y"]) {
    const ctx: TermCtx = { ...hn.ctx, call: (async () => ({ kinds: [{ key: "trash", value: v }] })) as never };
    assert.equal(await trashKeepMs(ctx), TRASH_KEEP_MS, v);
  }
});

// ---- third look T3 and T5: the network fallback, and the subnets from the start ------------------------------------------------------------------------------

test("T3: while the shared network cannot be had, it is tried once a minute (not on every exec), with one log line a minute, and the Console's health says so until the network exists", async () => {
  let fails = true;
  const clock = { t: 1_000_000 };
  const dk = engine({ networkFails: () => fails });
  let tries = 0;
  const http: typeof dk.http = (req) => { if (req.method === "POST" && req.path === "/networks/create") tries++; return dk.http(req); };
  const logs: string[] = [];
  const m = createWorkspaceManager({ api: createDockerApi(http), http, idleMs: 600_000, now: () => clock.t, log: (_l, msg) => { logs.push(msg); } });
  const creates = (): number => tries;
  await m.exec(AGENT, ["tmux", "-V"]);
  for (let i = 0; i < 20; i++) await m.exec(AGENT, ["tmux", "-V"]);
  assert.equal(creates(), 1, "one try, not one per exec");
  assert.equal(logs.filter((x) => x === "workspace.network_fallback").length, 1, "one log line");
  assert.match(m.networkNote() ?? "", /^Agent workspaces are on Docker's default network because the shared one could not be made: all predefined address pools have been fully subnetted\. They work, but can reach each other\.$/);
  clock.t += 61_000;
  fails = false;
  await m.ensure("agt_other");
  assert.equal(creates(), 2, "tried again after a minute");
  assert.equal(m.networkNote(), null, "cleared once the network exists");
  m.close();
});

test("T3: one failed try in a fresh process never moves a workspace already on the shared network back to the bridge", async () => {
  const dk = engine();
  const first = manager(dk);
  await first.exec(AGENT, ["tmux", "-V"]);
  assert.equal(dk.box(NAME).config["HostConfig"]["NetworkMode"], "vyre-workspaces");
  await first.sleep(AGENT);
  first.close();
  // a new process; its first try at the network fails for a moment (a timeout), though the network is there
  let once = true;
  const http: typeof dk.http = async (req) => { if (once && req.method === "POST" && req.path === "/networks/create") { once = false; throw new Error("timed out"); } return dk.http(req); };
  const removesBefore = dk.ops("remove").length;
  const after = createWorkspaceManager({ api: createDockerApi(http), http, idleMs: 600_000 });
  assert.equal((await after.exec(AGENT, ["tmux", "-V"])).code, 0);
  assert.equal(dk.box(NAME).config["HostConfig"]["NetworkMode"], "vyre-workspaces", "kept where it is");
  assert.equal(dk.ops("remove").length, removesBefore, "not rebuilt");
  after.close();
});

test("T5: right after a restart the subnets of running workspaces are known before any sweep or command, and a workspace on the default bridge puts the bridge's subnet on the list", async () => {
  const dk = engine();
  const first = manager(dk);
  await first.exec(AGENT, ["tmux", "-V"]);
  first.close();
  const after = manager(dk);
  await after.ready();
  assert.deepEqual(after.subnets(), ["172.31.0.0/24"], "the shared network's subnet, with no sweep and no command yet");
  after.close();
  // an old workspace on Docker's default bridge
  const dk2 = engine();
  const old = workspaceContainerConfig("agt_old", "vyre/agent-workspace:1", { projects: [] }, {}, "bridge");
  await dk2.http({ method: "POST", path: "/containers/create", query: { name: workspaceName("agt_old") }, json: old });
  await dk2.http({ method: "POST", path: `/containers/${workspaceName("agt_old")}/start` });
  const m2 = manager(dk2);
  await m2.ready();
  assert.ok(m2.subnets().includes("172.17.0.0/16"), `the bridge is listed: ${m2.subnets().join(", ")}`);
  m2.close();
});

test("T6: a person with the agent's tab open sees why it went blank when the agent is taken off a project, once, as the agent is told", async () => {
  const dk = engine();
  const m = manager(dk, { projectsOf: () => ["prj_site"] });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_live", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 100, rows: 30, folders: [] });
  const first = await host.read("trm_live", { lines: 30, since: 0 });
  await m.cut(AGENT, "prj_site");
  assert.equal(dk.box(NAME).running, false, "the cut stopped it");
  const told = await host.read("trm_live", { lines: 30, since: first.next });
  assert.match(told.text, /The agent was removed from a project, so its workspace restarted without that project's folder\. What was running in it stopped\./);
  const again = await host.read("trm_live", { lines: 30, since: told.next });
  assert.doesNotMatch(again.text, /removed from a project/, "said once");
  m.close();
});

test("making room never takes a workspace whose agent has a turn running, that was used in the last 90 s, or that a person has a tab attached to; the newcomer then waits; one slept for room tells its agent's next command", async () => {
  const clock = { t: 9_000_000 };
  const dk = engine();
  const slots = new Set<string>();
  const capacity = {
    async claim(id: string) { if (slots.has(id) || slots.size < 4) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
    async release(id: string) { slots.delete(id); },
  };
  const turns = new Set<string>(["agt_turn"]);
  const m = manager(dk, { capacity, now: () => clock.t, inTurn: (id) => turns.has(id) });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  for (const id of ["agt_turn", "agt_recent", "agt_watched", "agt_idle"]) await m.exec(id, ["tmux", "-V"]);
  await host.open({ terminalId: "trm_watch", target: { host: "agent_computer", agentId: "agt_watched" }, name: "agent", cols: 80, rows: 24, folders: [] });
  clock.t += 120_000;
  await m.exec("agt_recent", ["tmux", "-V"]);             // used 0 s ago: between two commands of one task
  await host.read("trm_watch", { lines: 30, since: 0 });  // a person's tab is attached
  // the newcomer takes the room of the one that is truly idle
  assert.equal(await m.ensure("agt_new1"), "created");
  assert.equal(dk.box(workspaceName("agt_idle")).running, false, "the idle one slept");
  for (const id of ["agt_turn", "agt_recent", "agt_watched"]) assert.equal(dk.box(workspaceName(id)).running, true, `${id} kept`);
  // nothing more may be taken: the next newcomer waits with the plain line
  await assert.rejects(() => m.ensure("agt_new2"), /^Error: Waiting for room on the Space server\./);
  for (const id of ["agt_turn", "agt_recent", "agt_watched"]) assert.equal(dk.box(workspaceName(id)).running, true, `${id} still kept`);
  // the slept one's next command says what happened, once
  clock.t += 200_000;
  turns.clear();
  const r = await host.open({ terminalId: "trm_idle", target: { host: "agent_computer", agentId: "agt_idle" }, name: "agent", cols: 80, rows: 24, folders: [] }).then(() => host.run("trm_idle", { command: "echo hi", env: {}, timeoutMs: 5000 }));
  assert.match(r.output, /^Your workspace was asleep and has been started again\. Programs that were running are gone; your files are as you left them\.\n/);
  const again = await host.run("trm_idle", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.doesNotMatch(again.output, /was asleep/, "once");
  m.close();
});

// ---- fourth look U3: a workspace whose network went while it slept ---------------------------------------------------------------------------------------------

test("U3: an asleep workspace whose old network was removed (to free a pool) while the shared one still cannot be made wakes on a network that exists, and its commands work", async () => {
  let fails = false;
  const dk = engine({ networkFails: () => fails });
  const OLD = "agt_sleeper";
  const oldNet = workspaceNetworkName(OLD);
  // made before 12 Nov behind the runner, on its own network, asleep
  await dk.http({ method: "POST", path: "/networks/create", json: { Name: oldNet, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.workspace": OLD } } });
  await dk.http({ method: "POST", path: "/containers/create", query: { name: workspaceName(OLD) }, json: workspaceContainerConfig(OLD, "vyre/agent-workspace:1", { projects: [] }, {}, oldNet) });
  // its network was removed to free a pool, and a site took the pool: the shared network cannot be made
  await dk.http({ method: "DELETE", path: `/networks/${oldNet}` });
  fails = true;
  const clock = { t: 1_000_000 };
  const m = manager(dk, { runner: true, now: () => clock.t });
  // while no pool is free nothing can start, and it says so plainly (never a container started without its network)
  await assert.rejects(() => m.exec(OLD, ["tmux", "-V"]), /^Error: This server has no room for another network for this workspace right now\./);
  assert.equal(dk.boxes.get(workspaceName(OLD))?.running ?? false, false, "not started without a network");
  // a pool frees up: the next command (past the minute's wait for the shared network) rebuilds it on a network that exists, and it works
  fails = false;
  clock.t += 61_000;
  const r = await m.exec(OLD, ["tmux", "-V"]);
  assert.equal(r.code, 0, "its command works");
  const net = dk.box(workspaceName(OLD)).config["HostConfig"]["NetworkMode"] as string;
  assert.equal(net, "vyre-workspaces");
  assert.equal((await dk.http({ method: "GET", path: `/networks/${net}` })).status, 200, `the network it started on (${net}) exists`);
  m.close();
});

// ---- fourth look U2: a file dropped while the workspace is quiet ------------------------------------------------------------------------------------------------

test("U2: a file a person drops into the agent's Files while the workspace is quiet is there for a command run at once, and a Files change alone brings it within seconds", async () => {
  // the stand-in mirror copies what is in "Files" into the workspace's ~/Vyre on each pass
  const files = new Map<string, string>();
  let copied = new Map<string, string>();
  let passes = 0;
  const dk = engine();
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { passes++; copied = new Map(files); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    intervalMs: 20,
  };
  const clock = { t: Date.now() };
  const m = manager(dk, { home, mirrorMaxMs: 60_000, now: () => clock.t });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_u2", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  // quiet for minutes: the mirror has slowed to its most
  clock.t += 10 * 60_000;
  await new Promise((r) => setTimeout(r, 300));
  clock.t += 30_000;   // the slowed mirror's last pass was half a minute ago when the person drops the file
  const before = passes;
  files.set("brief.md", "the brief");
  const r = await host.run("trm_u2", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.equal(r.exitCode, 0);
  assert.ok(passes > before, "a pass ran before the command");
  assert.equal(copied.get("brief.md"), "the brief", "the dropped file was copied in before the command ran");
  // and with no command: a Files event brings the next pass soon
  const before2 = passes;
  m.filesChanged();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(passes > before2, "a pass within a few ms of the Files change, not after the long wait");
  m.close();
});

test("making room: with the turn state read, an agent with no turn running is sleepable 10 s after its last command; only when the turn cannot be read does it wait 90 s", async () => {
  for (const [turnKnown, wait] of [[true, 10_000], [false, 90_000]] as const) {
    const clock = { t: 20_000_000 };
    const dk = engine();
    const slots = new Set<string>();
    const capacity = {
      async claim(id: string) { if (slots.has(id) || slots.size < 1) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
      async release(id: string) { slots.delete(id); },
    };
    const m = manager(dk, { capacity, now: () => clock.t, inTurn: () => (turnKnown ? false : undefined) });
    await m.exec("agt_idle", ["tmux", "-V"]);
    clock.t += 120_000;                       // woken two minutes ago
    await m.exec("agt_idle", ["tmux", "-V"]);  // its last command: the grace counts from here
    clock.t += wait - 1000;
    await assert.rejects(() => m.ensure("agt_new"), /Waiting for room/, `${turnKnown ? "known" : "unknown"}: still inside its grace`);
    clock.t += 2000;
    assert.equal(await m.ensure("agt_new"), "created", `${turnKnown ? "known" : "unknown"}: taken after ${wait / 1000} s`);
    m.close();
  }
});

test("two agents on a host with room for one never put each other to sleep twice within a minute: the second asks wait", async () => {
  const clock = { t: 30_000_000 };
  const dk = engine();
  const slots = new Set<string>();
  const capacity = {
    async claim(id: string) { if (slots.has(id) || slots.size < 1) { slots.add(id); return { state: "running" as const }; } return { state: "waiting" as const, line: "Waiting for room on the Space server." }; },
    async release(id: string) { slots.delete(id); },
  };
  const m = manager(dk, { capacity, now: () => clock.t, inTurn: () => false });
  await m.exec("agt_a", ["tmux", "-V"]);
  clock.t += 120_000;
  await m.exec("agt_b", ["tmux", "-V"]);   // a slept for b
  assert.equal(dk.box(workspaceName("agt_a")).running, false);
  clock.t += 20_000;                         // b idle 20 s: past its 10 s grace, but it was given room 20 s ago
  await assert.rejects(() => m.exec("agt_a", ["tmux", "-V"]), /Waiting for room/, "a waits rather than putting b to sleep again");
  assert.equal(dk.box(workspaceName("agt_b")).running, true);
  clock.t += 50_000;                         // over a minute since b was given room
  assert.equal((await m.exec("agt_a", ["tmux", "-V"])).code, 0, "then a may take it");
  m.close();
});

test("a Files change brings forward only the slowed mirrors whose folder it is in (or under); one it cannot place brings them all", async () => {
  const passes = new Map<string, number>();
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: (x) => ({ async pass() { passes.set(x.agentId, (passes.get(x.agentId) ?? 0) + 1); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    intervalMs: 20,
  };
  // Agents/<a>/<sub>: each agent's folder under Agents
  const parent: Record<string, string | null> = { fld_agents: null, fld_a: "fld_agents", fld_b: "fld_agents", fld_b_sub: "fld_b", fld_elsewhere: null };
  const folders = {
    agentRoot: (id: string) => (id === "agt_a" ? "fld_a" : id === "agt_b" ? "fld_b" : null),
    projectRoot: () => null,
    ancestors: (f: string) => { if (!(f in parent)) return null; const out: string[] = []; let at: string | null = f; while (at !== null) { out.push(at); at = parent[at] ?? null; } return out; },
    ofFile: (id: string) => (id === "fil_in_b" ? "fld_b_sub" : null),
  };
  const clock = { t: Date.now() };
  const m = manager(engine(), { home, folders, mirrorMaxMs: 60_000, now: () => clock.t });
  await m.ensure("agt_a"); await m.ensure("agt_b");
  clock.t += 10 * 60_000;
  await new Promise((r) => setTimeout(r, 400));   // both slowed to their most
  const count = (): { a: number; b: number } => ({ a: passes.get("agt_a") ?? 0, b: passes.get("agt_b") ?? 0 });
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 80));
  let before = count();
  m.filesChanged({ folderIds: ["fld_elsewhere"] }); await settle();
  assert.deepEqual(count(), before, "a change in another part of Files brings no mirror forward");
  before = count();
  m.filesChanged({ fileId: "fil_in_b" }); await settle();
  assert.equal(count().a, before.a, "not a's");
  assert.ok(count().b > before.b, "b's, for a file in a folder under its folder");
  before = count();
  m.filesChanged({ folderIds: ["fld_unknown"] }); await settle();
  assert.ok(count().a > before.a && count().b > before.b, "a folder it cannot place brings every slowed mirror forward, so a drop is never missed");
  m.close();
});

test("V3: in a workspace at the quick pace a command does not wait for a mirror pass; after a Files change in its folder it waits for one", async () => {
  let inPass = 0;
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { inPass++; await new Promise((r) => setTimeout(r, 300)); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    intervalMs: 3000,
  };
  const folders = { agentRoot: () => "fld_a", projectRoot: () => null, ancestors: (f: string) => (f === "fld_a" ? ["fld_a"] : null), ofFile: () => null };
  const m = manager(engine(), { home, folders });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_v3", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  await new Promise((r) => setTimeout(r, 400));   // the wake's pass is done
  const timed = async (): Promise<number> => { const t0 = Date.now(); await host.run("trm_v3", { command: "echo hi", env: {}, timeoutMs: 5000 }); return Date.now() - t0; };
  const before = inPass;
  const quick = await timed();
  assert.equal(inPass, before, "no pass for a command at the quick pace");
  assert.ok(quick < 250, `per-command overhead near zero: ${quick} ms`);
  m.filesChanged({ folderIds: ["fld_a"] });
  const after = await timed();
  assert.ok(inPass > before && after >= 250, `after a change in its folder the command waited for a pass (${after} ms)`);
  m.close();
});

// ---- release gate, 12 Nov: Stop reaches the command its turn started ------------------------------------------------------------------------------------------

test("turn.cancelled interrupts the command that turn started (its agent and thread), and run.stopped the one its run started; another chat's command keeps running", async () => {
  const { consumers } = await import("../impl.ts");
  const { agent, hn } = setup();
  const fh = fakeHost();
  const waits = new Map<string, () => void>();
  const host = {
    ...fh.host,
    async run(id: string, r: { command: string; signal?: AbortSignal }) {
      // a long command: it ends only when its signal is aborted
      return await new Promise<{ exitCode: number; output: string; truncated: boolean; durationMs: number }>((resolve) => {
        const done = (): void => resolve({ exitCode: 130, output: "^C Interrupted: the turn that started this command was stopped.", truncated: false, durationMs: 1 });
        if (r.signal?.aborted) done(); else r.signal?.addEventListener("abort", done, { once: true });
        waits.set(r.command, done);
      });
    },
  };
  bindHost(host as never);
  const other: TermCtx = { ...agent, thread: "thr_other" };
  const mine = h["terminal.run"]!(agent, { command: "sleep 120", idempotencyKey: idem() });
  const theirs = h["terminal.run"]!(other, { command: "sleep 121", session: "other", idempotencyKey: idem() });
  await until(() => waits.size === 2, "both commands running");
  const stop = consumers["terminal.turn_stopped"]!.run(hn.ctx, { payload: { agentId: AGENT, threadId: "thr_chat", turnId: "trn_1", by: "usr_dana" } });
  assert.deepEqual(stop, ["1"], "one command interrupted");
  const r = await mine;
  assert.equal(r.exitCode, 130);
  let settled = false;
  void theirs.then(() => { settled = true; });
  await new Promise((x) => setTimeout(x, 50));
  assert.equal(settled, false, "the other chat's command keeps running");
  waits.get("sleep 121")?.();
  await theirs;
});

test("W2: a folder moved between two agents' folders names both parents, so both mirrors are brought forward", async () => {
  const { filesChangeOf } = await import("../impl.ts");
  assert.deepEqual(filesChangeOf({ folderId: "fld_m", fromParentId: "fld_a", toParentId: "fld_b" }).folderIds.sort(), ["fld_a", "fld_b", "fld_m"]);
  assert.deepEqual(filesChangeOf({ fileId: "fil_1", fromFolderId: "fld_a", toFolderId: "fld_b" }), { folderIds: ["fld_a", "fld_b"], fileId: "fil_1" });
});

test("W3: at the quick pace, a command right after the agent's own Files write waits for one pass, though the Files event's consumer has not run yet", async () => {
  let inPass = 0;
  let lastWrite: number | null = null;
  const home: NonNullable<WorkspaceOptions["home"]> = {
    sync: () => ({ async pass() { inPass++; await new Promise((r) => setTimeout(r, 200)); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/m/${id}.json`,
    intervalMs: 3000,
  };
  const folders = { agentRoot: () => "fld_a", projectRoot: () => null, ancestors: () => null, ofFile: () => null, lastWriteBy: () => lastWrite };
  const m = manager(engine(), { home, folders });
  const host = createWorkspaceTerminalHost({ manager: m, sleep: fast });
  await host.open({ terminalId: "trm_w3", target: { host: "agent_computer", agentId: AGENT }, name: "agent", cols: 80, rows: 24, folders: [] });
  await new Promise((r) => setTimeout(r, 300));
  const before = inPass;
  await host.run("trm_w3", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.equal(inPass, before, "no own write since the last pass: no wait");
  lastWrite = Date.now();   // the agent wrote through Files; no event consumed yet
  await host.run("trm_w3", { command: "cat note.md", env: {}, timeoutMs: 5000 });
  assert.ok(inPass > before, "a pass ran before the command");
  m.close();
});

test("Stop: only a pressed Stop interrupts (never the host's turn.cancelled on a daemon stop, an update, a turn's end or after a restart); twice is once; no mark does nothing; a person's command is never interrupted", async () => {
  const { consumers } = await import("../impl.ts");
  const { agent, hn } = setup();
  const fh = fakeHost();
  const ended = new Map<string, number>();
  const host = {
    ...fh.host,
    async run(_id: string, r: { command: string; signal?: AbortSignal }) {
      return await new Promise<{ exitCode: number; output: string; truncated: boolean; durationMs: number }>((resolve) => {
        const done = (): void => { ended.set(r.command, (ended.get(r.command) ?? 0) + 1); resolve({ exitCode: 130, output: "stopped", truncated: false, durationMs: 1 }); };
        r.signal?.addEventListener("abort", done, { once: true });
        if (r.command.startsWith("finish")) resolve({ exitCode: 0, output: "ok", truncated: false, durationMs: 1 });
      });
    },
  };
  bindHost(host as never);
  const stop = consumers["terminal.turn_stopped"]!;
  const ev = (by: string, extra: Record<string, unknown> = {}) => ({ payload: { agentId: AGENT, threadId: "thr_chat", turnId: "trn_1", by, ...extra } });
  const running = h["terminal.run"]!(agent, { command: "sleep 120", idempotencyKey: idem() });
  await until(() => [...fh.calls].length >= 0 && true, "started");
  await new Promise((x) => setTimeout(x, 30));
  // the host's own turn.cancelled: daemon stop, update, the turn's end record, recovery after a restart
  assert.deepEqual(stop.run(hn.ctx, ev("svc_host")), [], "a daemon stop or a turn's end record interrupts nothing");
  assert.equal(ended.get("sleep 120") ?? 0, 0);
  // the press: once; the second event of the same Stop finds it stopped already
  assert.deepEqual(stop.run(hn.ctx, ev("usr_dana")), ["1"]);
  assert.deepEqual(stop.run(hn.ctx, ev("usr_dana")), []);
  await running;
  assert.equal(ended.get("sleep 120"), 1, "interrupted once");
  // a Stop for a run that already ended, or one this process never started: nothing is sent
  await h["terminal.run"]!(agent, { command: "finish now", idempotencyKey: idem() });
  assert.deepEqual(stop.run(hn.ctx, ev("usr_dana", { turnId: "trn_2" })), [], "no mark: nothing to interrupt");
  // a person's own command in that chat is never interrupted by an agent's Stop
  const person: TermCtx = { ...hn.ctx, thread: "thr_chat" };
  const theirs = h["terminal.run"]!(person, { command: "sleep 99", idempotencyKey: idem() }).catch(() => undefined);
  await new Promise((x) => setTimeout(x, 30));
  assert.deepEqual(stop.run(hn.ctx, ev("usr_dana", { turnId: "trn_3" })), [], "the person's command is not the agent's turn's");
  assert.equal(ended.get("sleep 99") ?? 0, 0);
  void theirs;
});
