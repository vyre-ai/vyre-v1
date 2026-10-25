// Terminal sessions (spec 2.7, 2.23; ARCH 6.7, 6.11, 7.2): open, type, resize, rename, close; an agent's commands land in one session as one step and "Open terminal" attaches that same
// session; Vault values filled into a command never come back out of the screen. Real SQLite, a scripted machine, every answer and event checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { openFrames, partialSpellingAt } from "../impl.ts";
import { bindHost, bindTeam, bindValues, commandsOf, redeemTicket } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, fakeHost, fakeValues, harness, reset } from "../fixtures/harness.ts";
import type { FakeHost, Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const rejects = async (f: () => unknown): Promise<string> => { try { await f(); } catch (e) { return codeOf(e); } return "no error"; };

const AGENT = { kind: "agent" as const, id: "agt_intake" };
let keys = 0;
const idem = (): string => `idem_${++keys}`;

function setup(scripts: Parameters<typeof fakeHost>[0] = {}): { hn: Harness; host: FakeHost } {
  reset();
  const hn = harness();
  const host = fakeHost(scripts);
  bindHost(host.host);
  return { hn, host };
}
const openAgent = (hn: Harness, over: Record<string, unknown> = {}): Promise<any> => call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: idem(), ...over });

// ---- open and close

test("open: an agent computer session is started on the machine, recorded, and announced without the command or screen", async () => {
  const { hn, host } = setup();
  const out = await openAgent(hn, { name: "build", cwd: "/work/site", cols: 100, rows: 30 });
  const t = out.terminal;
  assert.match(t.terminalId, /^trm_[a-z0-9]+$/);
  assert.deepEqual({ name: t.name, host: t.host, hostTitle: t.hostTitle, agentId: t.agentId, cwd: t.cwd, state: t.state, exitCode: t.exitCode, named: t.named, cols: t.cols, rows: t.rows },
    { name: "build", host: "agent_computer", hostTitle: "agt_intake's computer", agentId: "agt_intake", cwd: "/work/site", state: "idle", exitCode: null, named: true, cols: 100, rows: 30 });
  assert.deepEqual(host.calls[0], { op: "open", terminalId: t.terminalId, args: { target: { host: "agent_computer", agentId: "agt_intake" }, name: "build", cwd: "/work/site", cols: 100, rows: 30, folders: [] } });
  assert.deepEqual(hn.named("terminal.opened")[0]?.payload, { terminalId: t.terminalId, host: "agent_computer", agentId: "agt_intake", by: "usr_dana" });
  assert.deepEqual(assertEventsConform(hn), []);
  const dflt = await openAgent(hn);
  assert.equal(dflt.terminal.name, "Terminal 2");
  assert.equal(dflt.terminal.named, false);
  assert.deepEqual([dflt.terminal.cols, dflt.terminal.rows, dflt.terminal.cwd], [120, 32, "/home/agent"]);
});

test("open: the folders a person's rules add are handed to the machine", async () => {
  const { hn, host } = setup();
  await call(hn, "terminal.rules.set", { rules: { allow: [], ask: [], deny: [], folders: ["fld_work", "fld_notes"] } });
  await openAgent(hn);
  assert.deepEqual((host.calls[0]?.args as { folders: string[] }).folders, ["fld_work", "fld_notes"]);
});

test("open: refused in a Personal Space, without something to open it on, when the machine does not answer, and on a host with no terminals", async () => {
  const { hn, host } = setup();
  bindTeam(() => false);
  assert.equal(await rejects(() => h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_intake" })), "permission.needs_team");
  bindTeam(null);
  assert.equal(await rejects(() => h["terminal.open"]!(hn.ctx, { host: "agent_computer" })), "validation.bad_input");
  assert.equal(await rejects(() => h["terminal.open"]!(hn.ctx, { host: "device" })), "validation.bad_input");
  host.failOpenWith(true);
  assert.equal(await rejects(() => h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_intake" })), "provider.unavailable");
  assert.equal(hn.rows("SELECT * FROM terminal_sessions").length, 0, "a session that never started is not recorded");
  bindHost(null);
  assert.equal(await rejects(() => h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_intake" })), "provider.unavailable");
});

test("open on a device and open_server: the machine they name, and the server's own failure is an internal one", async () => {
  const { hn, host } = setup();
  const d = await call(hn, "terminal.open", { host: "device", deviceId: "dev_mac", idempotencyKey: idem() });
  assert.deepEqual([d.terminal.host, d.terminal.deviceId, d.terminal.hostTitle], ["device", "dev_mac", "This computer"]);
  const s = await call(hn, "terminal.open_server", { name: "ops", idempotencyKey: idem() });
  assert.deepEqual([s.terminal.host, s.terminal.hostTitle, s.terminal.name], ["space_server", "Space server", "ops"]);
  assert.deepEqual(host.calls.filter((c) => c.op === "open").map((c) => (c.args as { target: unknown }).target), [{ host: "device", deviceId: "dev_mac" }, { host: "space_server" }]);
  host.failOpenWith(true);
  assert.equal(await rejects(() => h["terminal.open_server"]!(hn.ctx, {})), "internal.unexpected");
});

test("close kills the session, is safe to repeat, and leaves the row readable; every other action then says it is gone", async () => {
  const { hn, host } = setup();
  const t = (await openAgent(hn)).terminal;
  assert.deepEqual(await call(hn, "terminal.close", { terminalId: t.terminalId }), { closed: true });
  assert.deepEqual(await call(hn, "terminal.close", { terminalId: t.terminalId }), { closed: true });
  assert.equal(host.count("close"), 1);
  assert.deepEqual(hn.named("terminal.closed").map((e) => e.payload), [{ terminalId: t.terminalId, by: "usr_dana" }]);
  assert.equal((await call(hn, "terminal.get", { terminalId: t.terminalId })).terminal.state, "exited");
  for (const [cap, input] of [["terminal.input", { data: "ls" }], ["terminal.interrupt", {}], ["terminal.resize", { cols: 80, rows: 24 }], ["terminal.read", {}], ["terminal.attach", {}], ["terminal.rename", { name: "x" }]] as const) {
    assert.equal(await rejects(() => h[cap]!(hn.ctx, { terminalId: t.terminalId, ...input })), "validation.not_found", cap);
  }
  assert.equal(await rejects(() => h["terminal.close"]!(hn.ctx, { terminalId: "trm_none" })), "validation.not_found");
  assert.equal(await rejects(() => h["terminal.get"]!(hn.ctx, { terminalId: "trm_none" })), "validation.not_found");
  assert.equal((await call(hn, "terminal.list", {})).total, 0, "a closed session leaves the list");
});

test("close still closes the row when the machine cannot be reached", async () => {
  const { hn, host } = setup();
  const t = (await openAgent(hn)).terminal;
  host.host.close = async () => { throw new Error("agentd is gone"); };
  assert.deepEqual(await call(hn, "terminal.close", { terminalId: t.terminalId }), { closed: true });
  assert.ok(hn.logged.some((l) => l.msg.includes("could not kill")));
});

// ---- typing

test("input, interrupt, resize and rename act on the session and keep its row current", async () => {
  const { hn, host } = setup();
  const t = (await openAgent(hn)).terminal;
  hn.advance(5_000);
  assert.deepEqual(await call(hn, "terminal.input", { terminalId: t.terminalId, data: "ls -la\r" }), { ok: true });
  assert.deepEqual(await call(hn, "terminal.interrupt", { terminalId: t.terminalId }), { ok: true });
  assert.deepEqual(await call(hn, "terminal.resize", { terminalId: t.terminalId, cols: 90, rows: 20 }), { ok: true });
  const r = await call(hn, "terminal.rename", { terminalId: t.terminalId, name: "  deploy  " });
  assert.deepEqual([r.terminal.name, r.terminal.named, r.terminal.cols, r.terminal.rows], ["deploy", true, 90, 20]);
  assert.deepEqual(host.calls.slice(1).map((c) => [c.op, c.args]), [["input", "ls -la\r"], ["interrupt", undefined], ["resize", { cols: 90, rows: 20 }]]);
  const row = (await call(hn, "terminal.get", { terminalId: t.terminalId })).terminal;
  assert.equal(row.lastActiveAt, t.createdAt + 5_000);
  assert.deepEqual(hn.named("terminal.renamed")[0]?.payload, { terminalId: t.terminalId, name: "deploy" });
  assert.equal(await rejects(() => h["terminal.rename"]!(hn.ctx, { terminalId: t.terminalId, name: "   " })), "validation.bad_input");
  assert.equal(await rejects(() => h["terminal.rename"]!(hn.ctx, { terminalId: t.terminalId, name: "x".repeat(81) })), "validation.bad_input");
  assert.equal(await rejects(() => h["terminal.input"]!(hn.ctx, { terminalId: t.terminalId, data: "" })), "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a machine that fails while typing is an internal error, not a silent success", async () => {
  const { hn, host } = setup();
  const t = (await openAgent(hn)).terminal;
  host.host.input = async () => { throw new Error("tmux: no server running"); };
  assert.equal(await rejects(() => h["terminal.input"]!(hn.ctx, { terminalId: t.terminalId, data: "x" })), "internal.unexpected");
  host.host.read = async () => { throw new Error("boom"); };
  assert.equal(await rejects(() => h["terminal.read"]!(hn.ctx, { terminalId: t.terminalId })), "internal.unexpected");
});

// ---- agent commands and Open terminal

test("an agent's commands are one step in one session, and Open terminal attaches that same session", async () => {
  const { hn, host } = setup({
    "git status": { exitCode: 0, output: "On branch main\nnothing to commit" },
    "npm test": { exitCode: 1, output: "FAIL 2 tests" },
  });
  const agent = hn.as(AGENT, "usr_dana", "run_7");
  const a = await call(hn, "terminal.run", { command: "git status", idempotencyKey: idem() }, agent);
  const b = await call(hn, "terminal.run", { command: "npm test", idempotencyKey: idem() }, agent);

  // One session for the agent on that machine, opened once, announced once.
  assert.equal(a.terminalId, b.terminalId);
  assert.equal(host.count("open"), 1);
  assert.deepEqual(host.calls[0], { op: "open", terminalId: a.terminalId, args: { target: { host: "agent_computer", agentId: "agt_intake" }, name: "agent", cols: 120, rows: 32, folders: [], cwd: undefined } });
  assert.equal(hn.named("terminal.opened").length, 1);
  assert.deepEqual([a.exitCode, a.output, b.exitCode, b.output], [0, "On branch main\nnothing to commit", 1, "FAIL 2 tests"]);

  // The chat block is built from this: "Ran 2 commands on the agent computer".
  const cmds = commandsOf(hn.db, a.terminalId);
  assert.deepEqual(cmds.map((c) => [c.command, c.exitCode, c.durationMs]), [["git status", 0, 12], ["npm test", 1, 12]]);
  const finished = hn.named("terminal.command_finished").map((e) => e.payload);
  assert.deepEqual(finished, [
    { terminalId: a.terminalId, exitCode: 0, durationMs: 12, by: "usr_dana", runId: "run_7" },
    { terminalId: a.terminalId, exitCode: 1, durationMs: 12, by: "usr_dana", runId: "run_7" },
  ]);
  assert.equal(JSON.stringify(hn.emitted).includes("git status"), false, "events never carry the command");
  assert.equal(JSON.stringify(hn.emitted).includes("FAIL 2 tests"), false, "or the output");
  assert.deepEqual(assertEventsConform(hn), []);

  // The person opens the terminal: the same session, with what the agent did on its screen.
  const dana = (await call(hn, "terminal.list", { section: "personal" })).terminals;
  assert.deepEqual(dana.map((t: any) => [t.terminalId, t.name, t.named, t.state]), [[a.terminalId, "agent", false, "idle"]]);
  const att = await call(hn, "terminal.attach", { terminalId: a.terminalId });
  assert.match(att.replay, /\$ git status/);
  assert.match(att.replay, /On branch main/);
  assert.match(att.replay, /FAIL 2 tests/);
  assert.equal(host.count("open"), 1, "attaching does not start a second session");
  assert.match(att.ticket, /^trt_[0-9a-f]{48}$/);
  assert.equal(att.expiresAt, hn.clock.t + 60_000);

  // The ticket opens the live connection to that session, once.
  assert.deepEqual(await redeemTicket(hn.db, att.ticket, hn.clock.t), { terminalId: a.terminalId, personId: "usr_dana" });
  assert.equal(await redeemTicket(hn.db, att.ticket, hn.clock.t), null, "spent");
  const att2 = await call(hn, "terminal.attach", { terminalId: a.terminalId });
  assert.equal(await redeemTicket(hn.db, att2.ticket, att2.expiresAt), null, "expired");
  assert.equal(await redeemTicket(hn.db, "trt_nope", hn.clock.t), null);
  assert.equal(JSON.stringify(hn.rows("SELECT * FROM terminal_tickets")).includes(att.ticket), false, "only the hash is kept");
});

test("a second agent, or the same agent for another person, gets its own session", async () => {
  const { hn, host } = setup({ pwd: { exitCode: 0, output: "/home/agent" } });
  const a = await call(hn, "terminal.run", { command: "pwd", idempotencyKey: idem() }, hn.as(AGENT, "usr_dana"));
  const b = await call(hn, "terminal.run", { command: "pwd", idempotencyKey: idem() }, hn.as({ kind: "agent", id: "agt_docs" }, "usr_dana"));
  const c = await call(hn, "terminal.run", { command: "pwd", idempotencyKey: idem() }, hn.as(AGENT, "usr_ravi"));
  assert.equal(new Set([a.terminalId, b.terminalId, c.terminalId]).size, 3);
  assert.equal(host.count("open"), 3);
  const again = await call(hn, "terminal.run", { command: "pwd", idempotencyKey: idem() }, hn.as(AGENT, "usr_dana"));
  assert.equal(again.terminalId, a.terminalId);
});

test("run in a named session goes to that session; a command that fails to start, times out or is empty is reported as such", async () => {
  const { hn, host } = setup({ ls: { exitCode: 0, output: "a\nb" } });
  const t = (await openAgent(hn)).terminal;
  const r = await call(hn, "terminal.run", { command: "ls", terminalId: t.terminalId, cwd: "/work", timeoutSec: 30, idempotencyKey: idem() });
  assert.equal(r.terminalId, t.terminalId);
  assert.deepEqual(host.calls.at(-1)?.args, { command: "ls", env: {}, cwd: "/work", timeoutMs: 30_000 });

  host.failRunWith(Object.assign(new Error("did not finish"), { code: "timeout" }));
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "sleep 999", terminalId: t.terminalId })), "timeout.deadline");
  const last = commandsOf(hn.db, t.terminalId).at(-1)!;
  assert.deepEqual([last.command, last.exitCode], ["sleep 999", null]);
  assert.equal(hn.named("terminal.command_finished").at(-1)?.payload["exitCode"], null);
  assert.equal((await call(hn, "terminal.get", { terminalId: t.terminalId })).terminal.state, "idle", "the session is free again");

  host.failRunWith(new Error("tmux: server exited"));
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: t.terminalId })), "provider.unavailable");
  host.failRunWith(null);
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "   " })), "validation.bad_input");
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "x".repeat(20_001), terminalId: t.terminalId })), "validation.bad_input");
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: "trm_none" })), "validation.not_found");
});

// ---- Vault values

test("a Vault value filled into a command never comes back: not in the answer, the record, the screen, the replay or the status", async () => {
  const KEY = "sk-live-ABCDEF123456";
  const { hn, host } = setup({
    "curl -H 'Authorization: sk-live-ABCDEF123456' https://api.example.com": { exitCode: 0, output: `{"echo":"Authorization: ${KEY}","ok":true}` },
  });
  bindValues(fakeValues({ "#Dana_Lawmatics.api_key": KEY }));
  const agent = hn.as(AGENT, "usr_dana");
  const r = await call(hn, "terminal.run", { command: "curl -H 'Authorization: #Dana_Lawmatics.api_key' https://api.example.com", idempotencyKey: idem() }, agent);
  assert.deepEqual((host.calls.at(-1)?.args as { command: string }).command, "curl -H 'Authorization: sk-live-ABCDEF123456' https://api.example.com", "the machine got the value");
  assert.equal(r.output.includes(KEY), false);
  assert.match(r.output, /\[#Dana_Lawmatics\.api_key\]/);
  assert.equal(JSON.stringify(commandsOf(hn.db, r.terminalId)).includes(KEY), false, "the record keeps the handle as written");
  assert.match(commandsOf(hn.db, r.terminalId)[0]!.command, /#Dana_Lawmatics\.api_key/);
  assert.equal(JSON.stringify(hn.emitted).includes(KEY), false);

  // The screen of the machine does hold it (the typed line was echoed); every way back out of the module scrubs it.
  assert.ok(host.screens.get(r.terminalId)!.join("\n").includes(KEY));
  assert.equal((await call(hn, "terminal.read", { terminalId: r.terminalId })).text.includes(KEY), false);
  assert.equal((await call(hn, "terminal.attach", { terminalId: r.terminalId })).replay.includes(KEY), false);
  const st = await call(hn, "terminal.status", { terminalIds: [r.terminalId] });
  assert.equal(JSON.stringify(st).includes(KEY), false);
  assert.equal(JSON.stringify(hn.logged).includes(KEY), false);
});

test("a handle the person may not use stops the command before it reaches the machine; an unknown handle is plain text", async () => {
  const { hn, host } = setup({ "echo #general": { exitCode: 0, output: "#general" } });
  bindValues(fakeValues({}, new Set(["#Team_Secret.token"])));
  const agent = hn.as(AGENT, "usr_dana");
  assert.equal(await rejects(() => h["terminal.run"]!(agent, { command: "deploy --token #Team_Secret.token" })), "permission.no_grant");
  assert.equal(host.count("run"), 0);
  assert.equal(hn.rows("SELECT * FROM terminal_commands").length, 0, "a command that never reached the machine is not a step");
  assert.equal(hn.named("terminal.command_finished").length, 0);
  const ok = await call(hn, "terminal.run", { command: "echo #general", idempotencyKey: idem() }, agent);
  assert.equal(ok.output, "#general");
  bindValues(null);
  const lit = await call(hn, "terminal.run", { command: "echo #general", idempotencyKey: idem() }, agent);
  assert.equal(lit.exitCode, 0, "with no Vault bound a handle stays literal");
});

test("a value too short to filter safely is refused, and the environment is filled too", async () => {
  const { hn, host } = setup({ "printenv TOKEN": { exitCode: 0, output: "tok_0123456789" } });
  bindValues(fakeValues({ "#Short.pin": "12", "#Dana_Api.token": "tok_0123456789" }));
  const agent = hn.as(AGENT, "usr_dana");
  assert.equal(await rejects(() => h["terminal.run"]!(agent, { command: "login #Short.pin" })), "validation.bad_input");
  const r = await call(hn, "terminal.run", { command: "printenv TOKEN", env: { TOKEN: "#Dana_Api.token" }, idempotencyKey: idem() }, agent);
  assert.deepEqual((host.calls.at(-1)?.args as { env: unknown }).env, { TOKEN: "tok_0123456789" });
  assert.equal(r.output.includes("tok_0123456789"), false);
});

// ---- reading

test("read returns the screen or only what is new since a cursor; status merges what the machine says with what Vyre recorded", async () => {
  const { hn, host } = setup({ ls: { exitCode: 0, output: "a\nb" } });
  const t = (await openAgent(hn)).terminal;
  await call(hn, "terminal.run", { command: "ls", terminalId: t.terminalId, idempotencyKey: idem() });
  const all = await call(hn, "terminal.read", { terminalId: t.terminalId });
  assert.equal(all.text, "$ ls\na\nb");
  assert.equal(all.next, 3);
  await call(hn, "terminal.input", { terminalId: t.terminalId, data: "more" });
  const fresh = await call(hn, "terminal.read", { terminalId: t.terminalId, since: all.next });
  assert.deepEqual([fresh.text, fresh.next], ["more", 4]);
  assert.equal((await call(hn, "terminal.read", { terminalId: t.terminalId, lines: 1 })).text, "more");

  const st = await call(hn, "terminal.status", { terminalIds: [t.terminalId, "trm_unknown"] });
  assert.deepEqual(st.rows, [{ terminalId: t.terminalId, state: "idle", lastLine: "more", exitCode: 0 }], "the last exit code Vyre recorded stays: tmux does not know one");
  host.host.status = async () => { throw new Error("agentd is down"); };
  assert.equal((await call(hn, "terminal.status", { terminalIds: [t.terminalId] })).rows[0].state, "idle", "falls back to the recorded state");
  bindHost(null);
  assert.equal((await call(hn, "terminal.status", { terminalIds: [t.terminalId] })).rows[0].terminalId, t.terminalId);
});

// ---- list

test("list: personal, shared and space sections, host and state filters, what the viewer may see, and paging", async () => {
  const { hn } = setup();
  const mine1 = (await openAgent(hn)).terminal;
  hn.advance(1000);
  const mine2 = (await call(hn, "terminal.open", { host: "device", deviceId: "dev_mac", idempotencyKey: idem() })).terminal;
  hn.advance(1000);
  const server = (await call(hn, "terminal.open_server", { idempotencyKey: idem() })).terminal;
  hn.advance(1000);
  const ravi = hn.as({ kind: "person", id: "usr_ravi" });
  const theirs = (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_docs", idempotencyKey: idem() }, ravi)).terminal;

  const ids = (r: any): string[] => r.terminals.map((t: any) => t.terminalId);
  assert.deepEqual(ids(await call(hn, "terminal.list", {})), [theirs.terminalId, server.terminalId, mine2.terminalId, mine1.terminalId], "newest activity first");
  assert.deepEqual(ids(await call(hn, "terminal.list", { section: "personal" })), [server.terminalId, mine2.terminalId, mine1.terminalId]);
  assert.deepEqual(ids(await call(hn, "terminal.list", { section: "shared" })), [theirs.terminalId]);
  assert.deepEqual(ids(await call(hn, "terminal.list", { section: "space" })), [server.terminalId]);
  assert.deepEqual(ids(await call(hn, "terminal.list", { host: "device" })), [mine2.terminalId]);
  assert.deepEqual(ids(await call(hn, "terminal.list", { state: ["running"] })), []);
  hn.allowOnly((_a, res) => res.id !== theirs.terminalId);
  assert.equal((await call(hn, "terminal.list", {})).total, 3, "a session the viewer has no access to is not listed");
  hn.allowOnly(() => true);
  const p1 = await call(hn, "terminal.list", { limit: 3 });
  assert.deepEqual([p1.terminals.length, p1.next, p1.total], [3, "3", 4]);
  const p2 = await call(hn, "terminal.list", { limit: 3, cursor: p1.next });
  assert.deepEqual([p2.terminals.length, p2.next], [1, undefined]);
});

// ---- health and the live relay

test("health: down with no terminals on the host, degraded when tmux is missing, healthy with the session count", async () => {
  const { hn, host } = setup();
  bindHost(null);
  const down = await call(hn, "terminal.health", {});
  assert.deepEqual([down.state, down.sessions], ["down", 0]);
  bindHost(host.host);
  await openAgent(hn);
  const up = await call(hn, "terminal.health", {});
  assert.deepEqual([up.state, up.sessions, up.detail], ["healthy", 1, "tmux 3.4"]);
  host.setInstalled(false);
  const missing = await call(hn, "terminal.health", {});
  assert.deepEqual([missing.state, missing.detail], ["degraded", "tmux is not installed on this host"]);
  host.host.health = async () => { throw new Error("socket closed"); };
  assert.equal((await call(hn, "terminal.health", {})).state, "down");
});

test("live frames: a spent ticket streams the session's output as it arrives, with Vault values removed even when split across frames, and closing stops it", async () => {
  const KEY = "sk-live-ABCDEF123456";
  const { hn, host } = setup({ "use key": { exitCode: 0, output: "ok" } });
  bindValues(fakeValues({ "#Dana_Api.key": KEY }));
  const r = await call(hn, "terminal.run", { command: "use key", env: { K: "#Dana_Api.key" }, idempotencyKey: idem() }, hn.as(AGENT, "usr_dana"));
  const att = await call(hn, "terminal.attach", { terminalId: r.terminalId });
  const got: string[] = [];
  const live = await openFrames(hn.db, att.ticket, hn.clock.t, (t) => got.push(t));
  assert.ok(live);
  assert.deepEqual([live.terminalId, live.personId], [r.terminalId, "usr_dana"]);

  host.emitFrame(r.terminalId, "building...\r\n");
  assert.deepEqual(got, ["building...\r\n"], "ordinary output is not held back");
  host.emitFrame(r.terminalId, `token is ${KEY}\r\n`);
  assert.equal(got.join("").includes(KEY), false);
  assert.match(got.join(""), /token is \[#Dana_Api\.key\]/);

  // A value cut in two by the frame boundary is not shown by either half.
  host.emitFrame(r.terminalId, "again sk-live-ABC");
  assert.equal(got.join("").endsWith("again "), true, "the start of a spelling waits for the next frame");
  host.emitFrame(r.terminalId, "DEF123456 done\r\n");
  assert.equal(got.join("").includes("ABC"), false);
  assert.match(got.join(""), /again \[#Dana_Api\.key\] done/);

  host.emitFrame(r.terminalId, "tail sk-live-AB");
  live.close();
  assert.equal(got.join("").includes("sk-live-AB"), false, "a held fragment is dropped, not flushed, when the tab closes");
  assert.equal(host.listeners(r.terminalId), 0);
  assert.equal(await openFrames(hn.db, att.ticket, hn.clock.t, () => {}), null, "a ticket opens one connection");
  bindHost(null);
  assert.equal(await openFrames(hn.db, "trt_x", hn.clock.t, () => {}), null);
});

test("partialSpellingAt finds the longest tail that could still become a spelling", () => {
  assert.equal(partialSpellingAt("abc sk-liv", ["sk-live-1"]), 6);
  assert.equal(partialSpellingAt("abc sk-live-1", ["sk-live-1"]), 0, "a whole spelling is the scrubber's, not held");
  assert.equal(partialSpellingAt("hello", ["sk-live-1"]), 0);
  assert.equal(partialSpellingAt("x s", ["sk-live-1", "s3cret"]), 1);
  assert.equal(partialSpellingAt("anything", []), 0);
});
