// A workspace holds many terminal tabs (owner, 6 Nov): named tmux sessions an agent opens, lists, runs into and closes; one tab for each helper, subagent or crew member it starts, labelled with
// the helper's name, in the parent's workspace and sharing its files; a helper never reaches another workspace. The machine is a scripted host; the container is tested in workspace.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost, bindPlace, bindWorkspaces } from "../projections.ts";
import type { TermCtx } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: TermCtx, input: any) => Promise<any> | any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let keys = 0;
const idem = (): string => `idem_tab_${++keys}`;
const call = async (ctx: TermCtx, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const failure = async (f: () => unknown): Promise<{ code: string; reason?: unknown }> => {
  try { await f(); } catch (e) { return { code: codeOf(e), reason: (e as { error?: { details?: { reason?: unknown } } }).error?.details?.reason }; }
  return { code: "no error" };
};

// threads: a chat the lead agent works in, a helper thread under it (the same agent), and crew threads of a teammate agent, one nested under another helper
const THREADS: Record<string, { kind: string; title?: string; parentThreadId?: string; agents: Array<{ agentId: string }> }> = {
  thr_lead: { kind: "chat", agents: [{ agentId: "agt_dex" }] },
  thr_help: { kind: "helper", title: "Read the logs", parentThreadId: "thr_lead", agents: [{ agentId: "agt_dex" }] },
  thr_ember: { kind: "helper", title: "Fix the build", parentThreadId: "thr_lead", agents: [{ agentId: "agt_ember" }] },
  thr_ember2: { kind: "helper", title: "Check one test", parentThreadId: "thr_ember", agents: [{ agentId: "agt_ember" }] },
  thr_other: { kind: "chat", agents: [{ agentId: "agt_pam" }] },
  thr_pamhelp: { kind: "helper", title: "Pam's helper", parentThreadId: "thr_other", agents: [{ agentId: "agt_pamhelper" }] },
};
const NAMES: Record<string, string> = { agt_ember: "Ember", agt_pamhelper: "Scout" };
const calls = async (cap: string, input: unknown): Promise<unknown> => {
  if (cap === "threads.get") { const t = THREADS[(input as { threadId: string }).threadId]; return t ? { thread: { threadId: (input as { threadId: string }).threadId, ...t } } : undefined; }
  if (cap === "agents.get") return { agent: { agentId: (input as { agentId: string }).agentId, name: NAMES[(input as { agentId: string }).agentId] ?? "Dex", ownerId: "usr_dana", kind: "teammate" } };
  throw new Error(`unexpected ${cap}`);
};

function setup() {
  reset();
  const hn = harness();
  const host = fakeHost({ "echo hi": { exitCode: 0, output: "hi" }, "make": { exitCode: 0, output: "built" } });
  bindHost(host.host);
  bindWorkspaces(true);
  bindPlace(async () => ({ team: true, agentComputer: false, runsOn: "space" as const }));
  const as = (agentId: string, thread: string): TermCtx => ({ ...hn.as({ kind: "agent", id: agentId }, "usr_dana", "run_1"), thread, call: calls as never });
  return { hn, host, as };
}
const opens = (host: ReturnType<typeof fakeHost>): Array<{ target: { agentId?: string }; name: string }> => host.calls.filter((c) => c.op === "open").map((c) => c.args as { target: { agentId?: string }; name: string });

test("an agent runs into named tabs: each name is its own tmux session, made on the first command and used again after; the default tab is the agent's own", async () => {
  const { host, as } = setup();
  const dex = as("agt_dex", "thr_lead");
  const own = await call(dex, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const build = await call(dex, "terminal.run", { command: "make", session: "build", idempotencyKey: idem() });
  const tests = await call(dex, "terminal.run", { command: "echo hi", session: "tests", idempotencyKey: idem() });
  const again = await call(dex, "terminal.run", { command: "make", session: "build", idempotencyKey: idem() });
  assert.equal(new Set([own.terminalId, build.terminalId, tests.terminalId]).size, 3, "three tabs");
  assert.equal(again.terminalId, build.terminalId, "the same name is the same tab");
  assert.deepEqual(opens(host).map((o) => [o.name, o.target.agentId]), [["agent", "agt_dex"], ["build", "agt_dex"], ["tests", "agt_dex"]]);
  const list = (await call(dex, "terminal.list", {})).terminals as Array<{ name: string; by?: { kind: string; name?: string }; named: boolean }>;
  assert.deepEqual(list.map((t) => [t.name, t.by?.kind, t.named]).sort(), [["agent", "agent", false], ["build", "agent", true], ["tests", "agent", true]]);
});

test("an agent opens a named tab with terminal_open and no host, lists its tabs and closes one; a tab that is closed is gone from the list", async () => {
  const { host, as } = setup();
  const dex = as("agt_dex", "thr_lead");
  const t = await call(dex, "terminal.open", { name: "server", idempotencyKey: idem() });
  assert.deepEqual([t.terminal.name, t.terminal.host, t.terminal.agentId, t.terminal.by], ["server", "agent_computer", "agt_dex", { kind: "agent" }]);
  assert.deepEqual(opens(host).map((o) => o.name), ["server"]);
  const run = await call(dex, "terminal.run", { command: "echo hi", terminalId: t.terminal.terminalId, idempotencyKey: idem() });
  assert.equal(run.terminalId, t.terminal.terminalId, "run into a tab by its id");
  assert.equal((await call(dex, "terminal.list", {})).terminals.length, 1);
  await call(dex, "terminal.close", { terminalId: t.terminal.terminalId });
  assert.equal((await call(dex, "terminal.list", {})).terminals.length, 0);
  assert.equal(host.count("close"), 1);
});

test("an agent lists only the tabs of its own workspace, never a person's other terminals or another agent's", async () => {
  const { hn, as } = setup();
  const dex = as("agt_dex", "thr_lead");
  await call(dex, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  await call(as("agt_pam", "thr_other"), "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  await call(hn.ctx, "terminal.open", { host: "device", deviceId: "dev_mac", name: "mine", idempotencyKey: idem() });
  const mine = (await call(dex, "terminal.list", {})).terminals as Array<{ agentId?: string; host: string }>;
  assert.deepEqual(mine.map((t) => [t.host, t.agentId]), [["agent_computer", "agt_dex"]]);
  assert.equal((await call(hn.ctx, "terminal.list", {})).terminals.length, 3, "the person sees all of theirs");
});

test("a helper that is the same agent gets its own tab in the same workspace, labelled with what it was asked", async () => {
  const { host, as } = setup();
  const lead = as("agt_dex", "thr_lead");
  const helper = as("agt_dex", "thr_help");
  const a = await call(lead, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const b = await call(helper, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.notEqual(a.terminalId, b.terminalId);
  assert.deepEqual(opens(host).map((o) => [o.name, o.target.agentId]), [["agent", "agt_dex"], ["helper: Read the logs", "agt_dex"]]);
  const rows = (await call(lead, "terminal.list", {})).terminals as Array<{ name: string; by?: { kind: string; name?: string } }>;
  assert.deepEqual(rows.map((t) => [t.name, t.by]).sort(), [["agent", { kind: "agent" }], ["helper: Read the logs", { kind: "helper", name: "Read the logs" }]]);
});

test("a crew member is its own agent but works in its lead's workspace, in a tab named for it, even nested under another helper", async () => {
  const { host, as } = setup();
  const ember = as("agt_ember", "thr_ember");
  const deep = as("agt_ember", "thr_ember2");
  const a = await call(ember, "terminal.run", { command: "make", idempotencyKey: idem() });
  assert.deepEqual(opens(host).map((o) => [o.name, o.target.agentId]), [["helper: Ember", "agt_dex"]], "the lead's workspace, Ember's tab");
  const b = await call(deep, "terminal.run", { command: "make", idempotencyKey: idem() });
  assert.equal(b.terminalId, a.terminalId, "a helper of Ember is in the same tab, named for the same crew member");
  const lead = as("agt_dex", "thr_lead");
  const rows = (await call(lead, "terminal.list", {})).terminals as Array<{ by?: { kind: string; name?: string }; agentId?: string }>;
  assert.deepEqual(rows.map((t) => [t.by, t.agentId]), [[{ kind: "helper", name: "Ember" }, "agt_dex"]], "the lead sees the tab and whose it is");
  // the crew member sees only its own tab, and cannot type in the lead's
  const leadTab = await call(lead, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual(((await call(ember, "terminal.list", {})).terminals as Array<{ name: string }>).map((t) => t.name), ["helper: Ember"]);
  const f = await failure(() => h["terminal.run"]!(ember, { command: "echo hi", terminalId: leadTab.terminalId }));
  assert.deepEqual([f.code, f.reason], ["permission.role_lacks_permission", "tab_not_yours"]);
  const g = await failure(() => h["terminal.close"]!(ember, { terminalId: leadTab.terminalId }));
  assert.deepEqual([g.code, g.reason], ["permission.role_lacks_permission", "tab_not_yours"]);
  await call(ember, "terminal.close", { terminalId: a.terminalId });
  assert.equal(host.count("close"), 1, "it closes its own");
});

test("a helper never reaches another workspace: its own chain only, whatever it names", async () => {
  const { host, as } = setup();
  const scout = as("agt_pamhelper", "thr_pamhelp");
  await call(scout, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.deepEqual(opens(host).map((o) => [o.name, o.target.agentId]), [["helper: Scout", "agt_pam"]], "Pam's workspace, from Pam's chat");
  const f = await failure(() => h["terminal.run"]!(scout, { command: "echo hi", agentId: "agt_dex" }));
  assert.equal(f.code, "permission.role_lacks_permission", "naming the lead of another chat gets nothing");
  const g = await failure(() => h["terminal.open"]!(scout, { host: "agent_computer", agentId: "agt_dex", name: "x" }));
  assert.equal(g.code, "permission.role_lacks_permission");
  assert.deepEqual(opens(host).map((o) => o.target.agentId), ["agt_pam"]);
  // a thread the host cannot read leaves the caller in its own workspace
  const lost = { ...as("agt_dex", "thr_missing") };
  await call(lost, "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  assert.equal(opens(host).at(-1)!.target.agentId, "agt_dex");
});

test("a person who opens a tab in a workspace they may enter is a person's tab; the list says so", async () => {
  const { hn, as } = setup();
  await call(as("agt_dex", "thr_lead"), "terminal.run", { command: "echo hi", idempotencyKey: idem() });
  const mine = { ...hn.ctx, call: calls as never };
  const t = await call(mine, "terminal.open", { host: "agent_computer", agentId: "agt_dex", name: "my shell", idempotencyKey: idem() });
  assert.deepEqual(t.terminal.by, { kind: "person" });
  const rows = (await call(mine, "terminal.list", {})).terminals as Array<{ name: string; by?: { kind: string } }>;
  assert.deepEqual(rows.map((r) => [r.name, r.by?.kind]).sort(), [["agent", "agent"], ["my shell", "person"]]);
});
