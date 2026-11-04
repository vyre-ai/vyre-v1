// Where an agent's terminal_run goes when it names no terminal and no host (owner, 2 Nov: "agents should be able to run terminal commands"): where the turn runs. In a Personal Space that is the
// person's computer the chat runs on, or the agent's own computer when the turn runs there; a Team Space keeps the agent's computer first. The person's rules and the Gate's condition are the same
// on every host, the session is the agent's own one per person, host and computer, and this machine runs a session in tmux or, with no tmux (a Mac), in a plain shell.
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalHost, createShellHost, handlers, isDangerCall, setTerminalHost } from "../impl.ts";
import type { ShellRun } from "../impl.ts";
import { bindHost, bindPlace, bindTeam, boundHost, commandsOf } from "../projections.ts";
import type { TermCtx, TurnPlace } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = { kind: "agent" as const, id: "agt_test" };
let keys = 0;
const idem = (): string => `idem_place_${++keys}`;
const call = async (ctx: TermCtx, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const failure = async (f: () => unknown): Promise<{ code: string; message: string; reason?: unknown }> => {
  try { await f(); } catch (e) { const x = (e as { error?: { code?: string; message?: string; details?: { reason?: unknown } } }).error; return { code: codeOf(e), message: x?.message ?? "", reason: x?.details?.reason }; }
  return { code: "no error", message: "" };
};

function setup(place: TurnPlace | null | "unbound", scripts: Parameters<typeof fakeHost>[0] = { "echo hi": { exitCode: 0, output: "hi" } }) {
  reset();
  const hn = harness();
  const host = fakeHost(scripts);
  bindHost(host.host);
  const asked: Array<{ space: string; threadId?: string; agentId: string; person: string }> = [];
  if (place !== "unbound") { const answer: TurnPlace | null = place; bindPlace(async (a) => { asked.push(a); return answer; }); }
  const agent: TermCtx = { ...hn.as(AGENT, "usr_dana", "run_1"), thread: "thr_chat" };
  return { hn, host, asked, agent };
}
const opened = (host: ReturnType<typeof fakeHost>): unknown[] => host.calls.filter((c) => c.op === "open").map((c) => (c.args as { target: unknown }).target);

const PERSONAL_HERE: TurnPlace = { team: false, agentComputer: false, runsOn: "device", deviceId: "dev_mac" };

test("Personal, on this computer: an agent's command with no host runs in its own session on the person's computer, asked as the person for this chat", async () => {
  const { hn, host, asked, agent } = setup(PERSONAL_HERE);
  const out = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual([out.exitCode, out.output], [0, "hi"]);
  assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  assert.deepEqual(asked, [{ space: hn.ctx.space, threadId: "thr_chat", agentId: "agt_test", person: "usr_dana" }]);
  // the person sees it under Terminals as this computer, with the command the agent ran
  const mine = (await call(hn.ctx, "terminal.list", { section: "personal" })).terminals;
  assert.deepEqual(mine.map((t: any) => [t.terminalId, t.host, t.hostTitle, t.deviceId, t.agentId, t.name]), [[out.terminalId, "device", "This computer", "dev_mac", "agt_test", "agent"]]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(commandsOf(hn.db, out.terminalId).map((c) => [c.command, c.exitCode]), [["echo hi", 0]]);
  const att = await call(hn.ctx, "terminal.attach", { terminalId: out.terminalId });
  assert.match(att.replay, /\$ echo hi\nhi/);
});

test("Personal: an agent that says the person's computer is never asked which one, and a person's own command is filled the same way only when it is an agent's", async () => {
  const { host, agent, hn } = setup(PERSONAL_HERE);
  await call(agent, "terminal.run", { command: "echo hi", host: "device", idempotencyKey: idem() });
  assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  // a person with no terminal and no computer named is asked, as before (the app names the terminal)
  const f = await failure(() => h["terminal.run"]!(hn.ctx, { command: "echo hi" }));
  assert.equal(f.code, "validation.bad_input");
});

test("Personal with an added server: the agent's own computer when it has one, else a plain refusal; never an agent computer that does not exist", async () => {
  {
    const { host, agent } = setup({ team: false, agentComputer: true, runsOn: "server" });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_test" }]);
  }
  {
    const { host, agent } = setup({ team: false, agentComputer: true, runsOn: "agent_computer" });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_test" }]);
  }
  {
    const { host, agent } = setup({ team: false, agentComputer: false, runsOn: "server" });
    const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi" }));
    assert.deepEqual([f.code, f.reason], ["provider.unavailable", "server"]);
    assert.match(f.message, /Your own shell runs there/);
    assert.deepEqual(opened(host), []);
  }
  {
    // a chat pinned to this computer runs here even when the agent has a computer elsewhere
    const { host, agent } = setup({ team: false, agentComputer: true, runsOn: "device", deviceId: "dev_mac" });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  }
});

test("Personal with no computer to run on, or nothing that says where the turn runs: a plain refusal that names the agent's own shell, and nothing is opened", async () => {
  {
    const { host, agent } = setup({ team: false, agentComputer: false, runsOn: "device" });
    const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi" }));
    // the chat runs on the person's own computer: the answer does not say there is no computer, it says whose shell to use
    assert.deepEqual([f.code, f.reason], ["provider.unavailable", "own_computer"]);
    assert.match(f.message, /runs on the person's own computer/);
    assert.doesNotMatch(f.message, /There is no computer/);
    assert.match(f.message, /Use your own shell in your work folder there, or ask the person to run it with terminal_request/);
    assert.deepEqual(opened(host), []);
  }
  {
    const { host, agent } = setup("unbound");
    bindTeam(() => false);
    const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi" }));
    assert.deepEqual([f.code, f.reason], ["provider.unavailable", "no_computer"]);
    assert.deepEqual(opened(host), [], "a Personal Space never falls back to an agent computer");
  }
  {
    const { host, agent } = setup(null);
    bindTeam(() => false);
    const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi" }));
    assert.equal(f.code, "provider.unavailable");
    assert.deepEqual(opened(host), []);
  }
});

test("Team: the agent's computer first when it has one; without one the turn's computer when this Space can reach it, else a plain refusal; unread, today's agent computer", async () => {
  {
    const { host, agent } = setup({ team: true, agentComputer: true, runsOn: "device", deviceId: "dev_mac" });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_test" }]);
  }
  {
    const { host, agent } = setup({ team: true, agentComputer: false, runsOn: "space" });
    const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi" }));
    assert.deepEqual([f.code, f.reason], ["provider.unavailable", "no_computer"]);
    assert.match(f.message, /You have no computer of your own in this Space/);
    assert.deepEqual(opened(host), []);
  }
  {
    const { host, agent } = setup({ team: true, agentComputer: false, runsOn: "device", deviceId: "dev_mac" });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  }
  {
    const { host, agent } = setup("unbound");
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_test" }]);
  }
  {
    // an explicit agent computer is the agent's choice and is not read again
    const { host, agent, asked } = setup(PERSONAL_HERE);
    await call(agent, "terminal.run", { command: "echo hi", host: "agent_computer", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_test" }]);
    assert.deepEqual(asked, []);
  }
});

test("the person's rules and the Gate's condition apply on the person's computer exactly as anywhere: a deny rule stops it before anything opens, red is still red", async () => {
  const { hn, host, agent } = setup(PERSONAL_HERE, { "rm -rf build": { exitCode: 0, output: "" }, "ls": { exitCode: 0, output: "a" } });
  await call(hn.ctx, "terminal.rules.set", { rules: { allow: [], ask: [], deny: ["rm"], folders: [] } });
  const f = await failure(() => h["terminal.run"]!(agent, { command: "rm -rf build" }));
  assert.equal(f.code, "permission.role_lacks_permission");
  assert.deepEqual(opened(host), [], "refused before a session is opened");
  assert.equal(host.count("run"), 0);
  assert.equal(await isDangerCall(null, { command: "rm -rf build" }), true, "the Gate still holds a destructive command");
  assert.equal(await isDangerCall(null, { command: "ls" }), false);
  await call(agent, "terminal.run", { command: "ls", idempotencyKey: idem() });
  assert.equal(host.count("run"), 1);
});

test("session reuse: one session per agent, person and computer; another computer of the person's, another agent or another person gets its own", async () => {
  const { hn, host, agent } = setup(PERSONAL_HERE);
  const a = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const b = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.equal(a.terminalId, b.terminalId);
  assert.equal(host.count("open"), 1);
  bindPlace(async () => ({ ...PERSONAL_HERE, deviceId: "dev_air" }));
  const c = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.notEqual(c.terminalId, a.terminalId);
  bindPlace(async () => PERSONAL_HERE);
  const d = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.equal(d.terminalId, a.terminalId, "back on the first computer, the first session");
  const other = await call({ ...hn.as({ kind: "agent", id: "agt_other" }, "usr_dana"), thread: "thr_chat" }, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const ravi = await call({ ...hn.as(AGENT, "usr_ravi"), thread: "thr_chat" }, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.equal(new Set([a.terminalId, c.terminalId, other.terminalId, ravi.terminalId]).size, 4);
  // a closed session is not reused
  await call(hn.ctx, "terminal.close", { terminalId: a.terminalId });
  const e = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.notEqual(e.terminalId, a.terminalId);
});

// ---- this machine

/** A shell stand-in: `echo X` prints X, `sleep` waits until aborted, anything else exits 127. */
function fakeShell() {
  const ran: Array<{ command: string; cwd: string; env: Readonly<Record<string, string>> }> = [];
  const run: ShellRun = async (a) => {
    ran.push({ command: a.command, cwd: a.cwd, env: a.env });
    const m = /^echo (.*)$/.exec(a.command);
    if (m) { a.onData(`${m[1]}\n`); return { exitCode: 0 }; }
    if (a.command === "sleep") return new Promise((resolve) => { a.signal.addEventListener("abort", () => resolve({ exitCode: 130 })); });
    a.onData(`${a.command}: command not found\n`);
    return { exitCode: 127 };
  };
  return { run, ran };
}

test("plain shell: a command runs in the session's folder and shows on its screen, a person's typed line runs on Enter, Ctrl-C and a timeout stop it, live frames follow", async () => {
  const sh = fakeShell();
  let t = 1000;
  const host = createShellHost({ run: sh.run, home: "/Users/dana", now: () => t });
  assert.deepEqual(await host.open({ terminalId: "trm_a", target: { host: "device", deviceId: "dev_mac" }, name: "agent", cols: 120, rows: 32, folders: [] }), { cwd: "/Users/dana" });
  const frames: string[] = [];
  const stop = host.stream!("trm_a", (f) => frames.push(f));
  const r = await host.run("trm_a", { command: "echo hi", env: { TOKEN: "x" }, timeoutMs: 1000 });
  assert.deepEqual([r.exitCode, r.output, r.truncated], [0, "hi", false]);
  assert.deepEqual(sh.ran[0], { command: "echo hi", cwd: "/Users/dana", env: { TOKEN: "x" } });
  assert.equal((await host.read("trm_a", { lines: 50 })).text, "$ echo hi\nhi");
  assert.equal(frames.join(""), "$ echo hi\r\nhi\r\n");
  await assert.rejects(host.run("trm_a", { command: "echo x", env: { "BAD NAME": "x" }, timeoutMs: 1000 }), /not a name/);
  // the person types a line and presses Enter: it runs, once on the screen
  await host.input("trm_a", "echo typed\r");
  await new Promise((r2) => setTimeout(r2, 10));
  assert.match((await host.read("trm_a", { lines: 50 })).text, /\$ echo typed\ntyped$/);
  assert.equal((await host.read("trm_a", { lines: 50 })).text.match(/echo typed/g)?.length, 1);
  // a command that does not end is stopped at its deadline
  await assert.rejects(host.run("trm_a", { command: "sleep", env: {}, timeoutMs: 20 }), (e: unknown) => (e as { code?: string }).code === "timeout");
  const s = (await host.status(["trm_a", "trm_gone"]));
  assert.deepEqual(s.map((x) => [x.terminalId, x.state]), [["trm_a", "idle"], ["trm_gone", "exited"]]);
  const running = host.run("trm_a", { command: "sleep", env: {}, timeoutMs: 5000 });
  assert.equal((await host.status(["trm_a"]))[0]!.state, "running");
  await host.interrupt("trm_a");
  assert.equal((await running).exitCode, 130);
  stop();
  await host.close("trm_a");
  await assert.rejects(host.read("trm_a", { lines: 5 }), /no such session/);
  assert.equal((await host.health()).ok, true);
  t += 1;
});

test("this machine: tmux when it is installed, a plain shell when not, and a target that is not this machine is refused at open", async () => {
  const sh = fakeShell();
  const tmuxCalls: string[][] = [];
  const noTmux = createLocalHost({
    exec: async (argv) => { tmuxCalls.push([...argv]); return { code: 127, stdout: "", stderr: "tmux: not found" }; },
    shell: sh.run, home: "/Users/dana", runsHere: (t) => t.host === "device",
  });
  await noTmux.open({ terminalId: "trm_p", target: { host: "device", deviceId: "dev_mac" }, name: "agent", cols: 80, rows: 24, folders: [] });
  assert.equal((await noTmux.run("trm_p", { command: "echo hi", env: {}, timeoutMs: 1000 })).output, "hi");
  assert.deepEqual(tmuxCalls, [["tmux", "-V"]], "tmux was asked for once, then the shell ran it");
  assert.match(String((await noTmux.health()).detail), /Install tmux/);
  await assert.rejects(noTmux.open({ terminalId: "trm_s", target: { host: "space_server" }, name: "x", cols: 80, rows: 24, folders: [] }), /not this one/);
  await assert.rejects(noTmux.open({ terminalId: "trm_c", target: { host: "agent_computer", agentId: "agt_test" }, name: "x", cols: 80, rows: 24, folders: [] }), /not this one/);

  const withTmux: string[][] = [];
  const tm = createLocalHost({
    exec: async (argv) => {
      withTmux.push([...argv]);
      if (argv[1] === "-V") return { code: 0, stdout: "tmux 3.4\n", stderr: "" };
      if (argv[1] === "display-message") return { code: 0, stdout: "/Users/dana\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    shell: sh.run, home: "/Users/dana", runsHere: (t) => t.host === "device",
  });
  assert.deepEqual(await tm.open({ terminalId: "trm_t", target: { host: "device", deviceId: "dev_mac" }, name: "agent", cols: 80, rows: 24, folders: [] }), { cwd: "/Users/dana" });
  assert.ok(withTmux.some((a) => a[1] === "new-session"), "the session is a tmux one");
  assert.equal(sh.ran.length, 1, "nothing more went to the plain shell");
});

test("the daemon's machine is used when nothing is bound in the process, a host bound in the process wins, and shutdown takes it away", async () => {
  reset();
  const sh = fakeShell();
  const asked: string[] = [];
  setTerminalHost({ exec: async () => ({ code: 127, stdout: "", stderr: "" }), shell: sh.run, home: "/Users/dana", runsHere: (t) => t.host === "device", place: async (a) => { asked.push(a.person); return PERSONAL_HERE; } });
  try {
    const hn: Harness = harness();
    const agent: TermCtx = { ...hn.as(AGENT, "usr_dana"), thread: "thr_chat" };
    const out = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual([out.exitCode, out.output], [0, "hi"]);
    assert.deepEqual(asked, ["usr_dana"]);
    assert.deepEqual(sh.ran.map((r) => r.command), ["echo hi"]);
    const stand = fakeHost({ "echo hi": { exitCode: 0, output: "from the stand-in" } });
    bindHost(stand.host);
    assert.equal(boundHost(), stand.host);
    bindHost(null);
    assert.notEqual(boundHost(), null, "the machine is still there");
  } finally { setTerminalHost(null); }
  assert.equal(boundHost(), null);
});

test("a terminal the call names is checked at Use by the handler, now that the capability is bound to the Space: the owner's own runs, a stranger's reads as missing", async () => {
  const { hn, host } = setup(PERSONAL_HERE);
  const ravis = (await call(hn.as({ kind: "person", id: "usr_ravi" }), "terminal.open", { host: "device", deviceId: "dev_ravi", idempotencyKey: idem() })).terminal.terminalId as string;
  const mine = (await call(hn.ctx, "terminal.open", { host: "device", deviceId: "dev_mac", idempotencyKey: idem() })).terminal.terminalId as string;
  const agent: TermCtx = { ...hn.as(AGENT, "usr_dana"), thread: "thr_chat" };
  hn.allowOnly((action, resource) => !(resource.type === "terminal" && resource.id === ravis && action.level === "use"));
  assert.equal((await call(agent, "terminal.run", { command: "echo hi", terminalId: mine, idempotencyKey: idem() })).output, "hi");
  const f = await failure(() => h["terminal.run"]!(agent, { command: "echo hi", terminalId: ravis }));
  assert.equal(f.code, "validation.not_found");
  assert.equal(host.calls.filter((c) => c.op === "run" && c.terminalId === ravis).length, 0);
  hn.allowOnly(() => true);
  assert.equal((await call(agent, "terminal.run", { command: "echo hi", terminalId: ravis, idempotencyKey: idem() })).output, "hi", "with a grant on it, it runs");
});
