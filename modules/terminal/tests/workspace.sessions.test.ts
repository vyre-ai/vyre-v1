// An agent's terminal goes to its workspace on the Space whichever computer its turn runs on (6 Nov), is made by the first use with no grant, and is entered only by who may: an agent in its own, a
// person in their own Assistant's, owners and admins in a team agent's, no one in another person's Assistant. The machine is a scripted host; the workspace container is tested in workspace.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, mayEnterWorkspace } from "../impl.ts";
import { bindHost, bindPlace, bindTeam, bindWorkspaces, commandsOf } from "../projections.ts";
import type { TermCtx, TurnPlace } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = { kind: "agent" as const, id: "agt_dex" };
let keys = 0;
const idem = (): string => `idem_ws_${++keys}`;
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

function setup(place: TurnPlace | null | "unbound", o: { workspaces?: boolean } = {}) {
  reset();
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  bindWorkspaces(o.workspaces !== false);
  if (place !== "unbound") bindPlace(async () => place);
  const agent: TermCtx = { ...hn.as(AGENT, "usr_dana", "run_1"), thread: "thr_chat" };
  return { hn, host, agent };
}
const hn0 = (c: TermCtx): TermCtx => c;
const opened = (host: ReturnType<typeof fakeHost>): unknown[] => host.calls.filter((c) => c.op === "open").map((c) => (c.args as { target: unknown }).target);
const TEAM_ON_MAC: TurnPlace = { team: true, agentComputer: true, runsOn: "device", deviceId: "dev_mac" };

test("an agent's command goes to its workspace wherever the turn runs: on the person's computer, on a server of theirs, on the Space, with or without a computer of its own", async () => {
  for (const place of [
    TEAM_ON_MAC,
    { team: true, agentComputer: false, runsOn: "device" as const, deviceId: "dev_mac" },
    { team: true, agentComputer: false, runsOn: "server" as const },
    { team: true, agentComputer: true, runsOn: "space" as const },
    null,
    "unbound" as const,
  ]) {
    const { host, agent } = setup(place);
    const out = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual([out.exitCode, out.output], [0, "hi"], JSON.stringify(place));
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_dex" }], JSON.stringify(place));
  }
});

test("the first command makes the session with no grant and no open call; the second command uses the same session; the person sees it listed with the agent's commands", async () => {
  const { hn, host, agent } = setup(TEAM_ON_MAC);
  const a = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const b = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.equal(a.terminalId, b.terminalId);
  assert.equal(host.count("open"), 1);
  const mine = (await call(hn.ctx, "terminal.list", { section: "personal" })).terminals;
  assert.deepEqual(mine.map((t: any) => [t.host, t.hostTitle, t.agentId, t.name]), [["agent_computer", "agt_dex's computer", "agt_dex", "agent"]]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(commandsOf(hn.db, a.terminalId).map((c) => c.command), ["echo hi", "echo hi"]);
});

test("a host that names the person's computer still gets it; a host with no workspaces keeps the older rule: where the turn runs; a Personal Space with a runtime has the workspace", async () => {
  {
    const { host, agent } = setup(TEAM_ON_MAC);
    await call(agent, "terminal.run", { command: "echo hi", host: "device", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  }
  {
    const { host, agent } = setup({ team: true, agentComputer: false, runsOn: "device", deviceId: "dev_mac" }, { workspaces: false });
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }], "no workspaces here: as before");
  }
  {
    // a Personal Space whose computer has a container runtime has the workspace too; without one (workspaces off) its agent's commands run on the person's computer
    const { host, agent } = setup({ team: false, agentComputer: false, runsOn: "device", deviceId: "dev_mac" });
    bindTeam(() => false);
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_dex" }]);
  }
  {
    const { host, agent } = setup({ team: false, agentComputer: false, runsOn: "device", deviceId: "dev_mac" }, { workspaces: false });
    bindTeam(() => false);
    await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
    assert.deepEqual(opened(host), [{ host: "device", deviceId: "dev_mac" }]);
  }
});

test("terminal_open on a workspace names the agent; an agent opens only its own workspace, never another's", async () => {
  const { agent, host } = setup(TEAM_ON_MAC);
  const f = await failure(() => h["terminal.open"]!(agent, { host: "agent_computer", agentId: "agt_other" }));
  assert.equal(f.code, "permission.role_lacks_permission");
  assert.deepEqual(opened(host), []);
  const own = await call(agent, "terminal.open", { host: "agent_computer", agentId: "agt_dex", idempotencyKey: idem() });
  assert.equal(own.terminal.host, "agent_computer");
  const noAgent = await failure(() => h["terminal.open"]!(hn0(agent), { host: "agent_computer" }));
  assert.equal(noAgent.code, "no error", "an agent that names no agent opens in its own workspace");
  const person = await failure(() => h["terminal.open"]!(harness().ctx, { host: "agent_computer" }));
  assert.equal(person.code, "validation.bad_input", "a person must say whose workspace");
  const noHost = await failure(() => h["terminal.open"]!(harness().ctx, {}));
  assert.equal(noHost.code, "validation.bad_input", "a person who names no host is asked");
  const viaOther = await failure(() => h["terminal.run"]!(agent, { command: "echo hi", agentId: "agt_other" }));
  assert.equal(viaOther.code, "permission.role_lacks_permission", "an agent that names another agent's id gets nothing of it");
});

// ---- who may enter a workspace -----------------------------------------------------------------------------------------------------------------------

function facts(table: Record<string, { ownerId: string; kind?: string; runtime?: string }>) {
  return (cap: string, input: unknown): Promise<unknown> => {
    if (cap !== "agents.get") throw new Error(`unexpected ${cap}`);
    const a = table[(input as { agentId: string }).agentId];
    return Promise.resolve(a ? { agent: { agentId: (input as { agentId: string }).agentId, ...a } } : undefined);
  };
}
const AGENTS = {
  agt_dana_assistant: { ownerId: "usr_dana", kind: "assistant" },
  agt_lee_assistant: { ownerId: "usr_lee", kind: "assistant" },
  agt_lee_outside: { ownerId: "usr_lee", runtime: "outside" },
  agt_dex: { ownerId: "usr_lee", kind: "teammate" },
};
const asPerson = (id: string, manage: boolean, raw?: ReturnType<typeof harness>["raw"]): TermCtx => {
  const hn = harness({ ...(raw ? { raw } : {}), allow: (a) => a.level !== "manage" || manage });
  return { ...hn.as({ kind: "person", id }), call: facts(AGENTS) as never, authorize: (a) => ({ effect: a.level !== "manage" || manage ? "allow" : "deny" }) };
};

test("who may enter: a person their own Assistant's workspace; an owner or admin a team agent's; a member not another's; nobody another person's Assistant or outside agent, whatever their role", async () => {
  const dana = asPerson("usr_dana", false);
  const admin = asPerson("usr_admin", true);
  const member = asPerson("usr_sam", false);
  assert.equal(await mayEnterWorkspace(dana, "agt_dana_assistant"), true, "own Assistant");
  assert.equal(await mayEnterWorkspace(member, "agt_dana_assistant"), false, "a member in someone else's Assistant");
  assert.equal(await mayEnterWorkspace(admin, "agt_dana_assistant"), false, "an admin in someone else's Assistant: private to its person");
  assert.equal(await mayEnterWorkspace(admin, "agt_lee_outside"), false, "an admin in someone else's outside agent");
  assert.equal(await mayEnterWorkspace(admin, "agt_dex"), true, "an admin in a team agent's");
  assert.equal(await mayEnterWorkspace(member, "agt_dex"), false, "a member in a team agent's");
  assert.equal(await mayEnterWorkspace(asPerson("usr_lee", false), "agt_dex"), true, "its owner");
  assert.equal(await mayEnterWorkspace(member, "agt_unknown"), false, "an agent nobody can read");
  assert.equal(await mayEnterWorkspace(admin, "agt_unknown"), true, "an agent the host cannot read: Manage decides");
  assert.equal(await mayEnterWorkspace({ ...admin, principal: AGENT }, "agt_dex"), true, "an agent in its own");
  assert.equal(await mayEnterWorkspace({ ...admin, principal: AGENT }, "agt_x"), false, "an agent in another's");
});

test("attach, read, type, interrupt, resize and close on a workspace session are all held to it; a refusal opens nothing and sends nothing", async () => {
  const { hn, host, agent } = setup(TEAM_ON_MAC);
  const run = await call(agent, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const member = asPerson("usr_sam", false, hn.raw);
  const dana = asPerson("usr_dana", false, hn.raw);
  const admin = asPerson("usr_admin", true, hn.raw);
  const before = host.calls.length;
  for (const [cap, extra] of [["terminal.attach", {}], ["terminal.read", {}], ["terminal.input", { data: "ls\n" }], ["terminal.interrupt", {}], ["terminal.resize", { cols: 80, rows: 24 }], ["terminal.close", {}]] as const) {
    const f = await failure(() => h[cap]!(member, { terminalId: run.terminalId, ...extra }));
    assert.equal(f.code, "permission.role_lacks_permission", cap);
    assert.equal(f.reason, "workspace_private", cap);
    // Dex is a team agent owned by usr_lee: Dana is neither its owner nor an admin
    const g = await failure(() => h[cap]!(dana, { terminalId: run.terminalId, ...extra }));
    assert.equal(g.code, "permission.role_lacks_permission", `${cap} for a person who is not its owner`);
  }
  assert.equal(host.calls.length, before, "nothing reached the machine");
  const att = await call(admin, "terminal.attach", { terminalId: run.terminalId });
  assert.match(att.replay, /\$ echo hi\nhi/, "an admin attaches to a team agent's workspace and sees the same screen");
  assert.equal((await call(admin, "terminal.input", { terminalId: run.terminalId, data: "ls\n" })).ok, true);
});

test("a person attaches to their own Assistant's session and types in it", async () => {
  reset();
  bindWorkspaces(true);
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  bindHost(host.host);
  bindPlace(async () => TEAM_ON_MAC);
  const dana = asPerson("usr_dana", false);
  const assistant: TermCtx = { ...dana, principal: { kind: "agent", id: "agt_dana_assistant" }, actingFor: "usr_dana", thread: "thr_1" };
  const run = await call(assistant, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const att = await call(dana, "terminal.attach", { terminalId: run.terminalId });
  assert.match(att.replay, /hi/);
  assert.equal((await call(dana, "terminal.input", { terminalId: run.terminalId, data: "ls\n" })).ok, true);
  assert.deepEqual(opened(host), [{ host: "agent_computer", agentId: "agt_dana_assistant" }]);
});

// ---- what the Terminal tab shows ---------------------------------------------------------------------------------------------------------------------

import { bindTeam as bindTeamFor, bindWorkspaceStatus } from "../projections.ts";

// the ids of this file's agents have underscores the contract's pattern does not allow, so the input is not checked here; the output is
const wsOf = async (ctx: TermCtx, input: { agentId: string }): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const out = await h["terminal.workspace"]!(ctx, input);
  assert.deepEqual(contractErrors("terminal.workspace", "out", out), [], "terminal.workspace output");
  return out;
};

test("terminal.workspace: the state, where it is and whether this person may attach; with no machine one plain line, personal and team worded apart; another person's Assistant says only that it is not theirs", async () => {
  reset();
  const dana = asPerson("usr_dana", false);
  bindWorkspaces(async () => true);
  bindWorkspaceStatus(async (id) => (id === "agt_dana_assistant" ? { state: "running", host: "space", projects: ["prj_a"] } : { state: "waiting", line: "Waiting for room on the Space server. Add a compute server in Console > Computers to run more." }));
  const own = await wsOf(dana, { agentId: "agt_dana_assistant" });
  assert.deepEqual(own, { state: "running", host: "space", projects: ["prj_a"], canAttach: true });
  const others = await wsOf(dana, { agentId: "agt_lee_assistant" });
  assert.deepEqual(others, { state: "none", canAttach: false, cannotAttach: "That workspace is not yours to open. A person opens their own Assistant's; an owner or admin opens a team agent's." });
  const admin = asPerson("usr_admin", true);
  const waiting = await wsOf(admin, { agentId: "agt_dex" });
  assert.equal(waiting.state, "waiting");
  assert.match(waiting.line, /^Waiting for room on the Space server\./);
  assert.equal(waiting.canAttach, false, "nothing to attach to while it waits");
  // no machine for this agent: the plain line, and its commands run where the turn runs
  bindWorkspaces(async () => false);
  bindTeamFor(() => false);
  const personal = await wsOf(dana, { agentId: "agt_dana_assistant" });
  assert.deepEqual([personal.state, personal.canAttach, personal.line], ["unavailable", false, "Your Assistant runs commands on this computer. Install Docker or add a server in Console > Computers to give it a workspace of its own."]);
  bindTeamFor(() => true);
  assert.match((await wsOf(admin, { agentId: "agt_dex" })).line, /^This Space has no machine to run agent workspaces on\. Add a server in Console > Computers\.$/);
  bindWorkspaceStatus(null);
  bindWorkspaces(false);
  bindTeamFor(null);
});
