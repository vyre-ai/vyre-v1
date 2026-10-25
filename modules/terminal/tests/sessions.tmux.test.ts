// The tmux adapter every host shares (ARCH 7.2): the exact tmux command lines it issues, how a command's output is told apart from the screen around it, timeouts, the control-mode frames, and
// the whole module working through it against a stand-in tmux. No real tmux runs here; the stand-in answers the same command lines.
import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxHost, decodeControlOutput, frameOf, handlers, shQuote } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { codeOf, contractErrors, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { fakeTmux } from "../fixtures/fake-tmux.ts";
import type { FakeTmuxOptions } from "../fixtures/fake-tmux.ts";

/** A clock that only moves when the adapter sleeps, so a timeout takes no real time. */
function rig(o: FakeTmuxOptions = {}, extra: { maxOutput?: number; scrollback?: number } = {}) {
  const tm = fakeTmux(o);
  const clock = { t: 0 };
  const host = createTmuxHost({ exec: tm.exec, control: tm.control, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, pollMs: 50, ...extra });
  return { tm, host, clock };
}
const open = (host: ReturnType<typeof createTmuxHost>, id = "trm_a1", extra: { cwd?: string } = {}) =>
  host.open({ terminalId: id, target: { host: "agent_computer", agentId: "agt_intake" }, name: "build", cols: 100, rows: 30, folders: [], ...extra });

test("shQuote closes, escapes and reopens around a single quote, so a value cannot end its own quoting", () => {
  assert.equal(shQuote("plain"), "'plain'");
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.equal(shQuote("a'; rm -rf /; '"), `'a'\\''; rm -rf /; '\\'''`);
  assert.equal(shQuote(""), "''");
});

test("open: one tmux session named for the terminal, at the size and folder asked for; the folder it reports is where the shell is", async () => {
  const { tm, host } = rig();
  const r = await open(host, "trm_a1", { cwd: "/work/site" });
  assert.deepEqual(tm.calls[0], ["tmux", "new-session", "-d", "-s", "vyre-trm_a1", "-x", "100", "-y", "30", "-c", "/work/site"]);
  assert.deepEqual(r, { cwd: "/work/site" });
  const none = await open(host, "trm_a2");
  assert.deepEqual(none, { cwd: "/home/agent" });
  assert.ok(!tm.calls[2]!.includes("-c"), "no folder asked for, none passed");
  await assert.rejects(() => open(host, "trm_a1"), /duplicate session/);
});

test("input is sent literally in pieces of at most 1000 characters; interrupt is Ctrl-C; resize resizes the window", async () => {
  const { tm, host } = rig();
  await open(host);
  tm.calls.length = 0;
  await host.input("trm_a1", "ls -la\r");
  await host.input("trm_a1", "é".repeat(2500));
  await host.interrupt("trm_a1");
  await host.resize("trm_a1", 80, 24);
  assert.deepEqual(tm.calls[0], ["tmux", "send-keys", "-t", "vyre-trm_a1", "-l", "--", "ls -la\r"]);
  assert.equal(tm.calls.filter((c) => c[1] === "send-keys" && c.includes("-l")).length, 4, "1 + 3 pieces");
  assert.deepEqual(tm.calls.at(-2), ["tmux", "send-keys", "-t", "vyre-trm_a1", "C-c"]);
  assert.deepEqual(tm.calls.at(-1), ["tmux", "resize-window", "-t", "vyre-trm_a1", "-x", "80", "-y", "24"]);
  assert.deepEqual([tm.sessions.get("vyre-trm_a1")!.cols, tm.sessions.get("vyre-trm_a1")!.rows], [80, 24]);
});

test("read: the last lines of the screen, or only what came after a cursor", async () => {
  const { tm, host } = rig();
  await open(host);
  tm.write("vyre-trm_a1", "one\ntwo\nthree\nfour");
  const last2 = await host.read("trm_a1", { lines: 2 });
  assert.deepEqual(last2.text, "three\nfour");
  const all = await host.read("trm_a1", { lines: 100 });
  assert.equal(all.text, "one\ntwo\nthree\nfour");
  tm.write("vyre-trm_a1", "five");
  const fresh = await host.read("trm_a1", { lines: 100, since: all.next });
  assert.deepEqual([fresh.text, fresh.next], ["five", all.next + 1]);
});

// ---- run

test("run: the shell prints its own markers around the command, and the output is exactly what came between them", async () => {
  const { tm, host } = rig({ scripts: { "git status": { out: "On branch main\nnothing to commit", code: 0 }, "false": { out: "", code: 1 }, "make": { out: "cc a.c\ncc b.c\nerror: b.c:3", code: 2 } } });
  await open(host);
  const a = await host.run("trm_a1", { command: "git status", env: {}, timeoutMs: 5000 });
  assert.deepEqual({ exitCode: a.exitCode, output: a.output, truncated: a.truncated }, { exitCode: 0, output: "On branch main\nnothing to commit", truncated: false });
  const b = await host.run("trm_a1", { command: "false", env: {}, timeoutMs: 5000 });
  assert.deepEqual([b.exitCode, b.output], [1, ""]);
  const c = await host.run("trm_a1", { command: "make", env: {}, timeoutMs: 5000 });
  assert.deepEqual([c.exitCode, c.output], [2, "cc a.c\ncc b.c\nerror: b.c:3"]);
  // What it typed is one line with the command in braces, so `cd` and exports stay in the session like typed by hand.
  const typed = tm.calls.find((x) => x[1] === "send-keys" && x.includes("-l") && x.at(-1)!.includes("git status"))!.at(-1)!;
  assert.match(typed, /^printf '%s\\n' '__VYRE_BEG_[0-9a-f]{12}__'; \{ git status\n\}; printf '\\n%s:%d\\n' '__VYRE_END_[0-9a-f]{12}__' \$\?$/);
  assert.ok(tm.calls.some((x) => x[1] === "send-keys" && x.at(-1) === "Enter"));
  // The screen keeps the earlier output; a later command's answer is not mixed with it.
  assert.match(tm.screen("vyre-trm_a1"), /On branch main/);
});

test("run: a folder to run in, and variables, which live in a subshell and are quoted so a value cannot become a command", async () => {
  const { tm, host } = rig({ scripts: { "echo $A": { out: "ok", code: 0 } } });
  await open(host);
  const r = await host.run("trm_a1", { command: "echo $A", cwd: "/work/it's", env: { A: "x'; touch /tmp/pwned; '", B: "plain" }, timeoutMs: 5000 });
  assert.deepEqual([r.exitCode, r.output], [0, "ok"]);
  const typed = tm.calls.find((x) => x[1] === "send-keys" && x.includes("-l") && x.at(-1)!.includes("echo $A"))!.at(-1)!;
  assert.ok(typed.includes(`cd '/work/it'\\''s' && ( export A='x'\\''; touch /tmp/pwned; '\\''' B='plain'; echo $A\n)`), typed);
  await assert.rejects(() => host.run("trm_a1", { command: "ls", env: { "A B": "x" }, timeoutMs: 5000 }), /not a name/);
  await assert.rejects(() => host.run("trm_a1", { command: "ls", env: { "A;rm": "x" }, timeoutMs: 5000 }), /not a name/);
});

test("run: output that merely looks like a marker is not one, and a command whose output has no newline still ends cleanly", async () => {
  const { host } = rig({ scripts: {
    spoof: { out: "__VYRE_END_000000000000__:0\n__VYRE_BEG_000000000000__\nstill output", code: 3 },
    nonl: { out: "abc", code: 0 },
  } });
  await open(host);
  const a = await host.run("trm_a1", { command: "spoof", env: {}, timeoutMs: 5000 });
  assert.equal(a.exitCode, 3);
  assert.match(a.output, /still output$/);
  const b = await host.run("trm_a1", { command: "nonl", env: {}, timeoutMs: 5000 });
  assert.deepEqual([b.exitCode, b.output], [0, "abc"]);
});

test("run: a command that does not finish is interrupted at the deadline and reported as a timeout; the session is usable afterwards", async () => {
  const { tm, host, clock } = rig({ scripts: { "sleep 999": { hang: true }, ls: { out: "a", code: 0 } } });
  await open(host);
  await assert.rejects(() => host.run("trm_a1", { command: "sleep 999", env: {}, timeoutMs: 1000 }), (e: unknown) => (e as { code?: string }).code === "timeout");
  assert.ok(clock.t >= 1000 && clock.t < 1200, `waited about the deadline (${clock.t} ms)`);
  assert.ok(tm.calls.some((x) => x[1] === "send-keys" && x.at(-1) === "C-c"), "Ctrl-C was sent");
  assert.equal(tm.sessions.get("vyre-trm_a1")!.hung, false);
  assert.equal((await host.run("trm_a1", { command: "ls", env: {}, timeoutMs: 1000 })).output, "a");
});

test("run: long output keeps its end and says it was cut", async () => {
  const big = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const { host } = rig({ scripts: { big: { out: big, code: 0 } } }, { maxOutput: 5000 });
  await open(host);
  const r = await host.run("trm_a1", { command: "big", env: {}, timeoutMs: 5000 });
  assert.equal(r.truncated, true);
  assert.equal(r.output.length, 5000);
  assert.ok(r.output.endsWith("line 399 " + "x".repeat(40)));
});

test("run: when the start of the output has scrolled out of the history, what is left is returned and marked cut", async () => {
  const big = Array.from({ length: 50 }, (_, i) => `row ${i}`).join("\n");
  const { host } = rig({ scripts: { big: { out: big, code: 0 } } }, { scrollback: 20 });
  await open(host);
  const r = await host.run("trm_a1", { command: "big", env: {}, timeoutMs: 5000 });
  assert.deepEqual([r.exitCode, r.truncated], [0, true]);
  assert.ok(r.output.endsWith("row 49"));
});

// ---- status, close, health

test("status: running while a program holds the pane, idle at a shell, exited when the session is gone; the last line is the last thing printed", async () => {
  const { tm, host } = rig({ scripts: { "sleep 999": { hang: true } } });
  await open(host, "trm_a1");
  await open(host, "trm_a2");
  tm.write("vyre-trm_a1", "hello\nlast thing  \n\n");
  assert.deepEqual(await host.status(["trm_a1", "trm_a2", "trm_gone"]), [
    { terminalId: "trm_a1", state: "idle", lastLine: "last thing", exitCode: null },
    { terminalId: "trm_a2", state: "idle", exitCode: null },
    { terminalId: "trm_gone", state: "exited", exitCode: null },
  ]);
  await host.run("trm_a2", { command: "sleep 999", env: {}, timeoutMs: 100 }).catch(() => undefined);
  await host.input("trm_a2", "sleep 999");
  tm.sessions.get("vyre-trm_a2")!.hung = true;
  assert.equal((await host.status(["trm_a2"]))[0]!.state, "running");
});

test("close kills the tmux session; a session that is already gone is closed; a real failure is an error", async () => {
  const { tm, host } = rig();
  await open(host);
  await host.close("trm_a1");
  assert.equal(tm.sessions.size, 0);
  await host.close("trm_a1");
  const failing = createTmuxHost({ exec: async () => ({ code: 1, stdout: "", stderr: "permission denied" }) });
  await assert.rejects(() => failing.close("trm_a1"), /kill-session failed/);
});

test("health: tmux missing, or present with the number of Vyre sessions in it", async () => {
  const missing = rig({ installed: false });
  assert.deepEqual(await missing.host.health(), { ok: false, detail: "tmux is not installed on this host", sessions: 0 });
  const { tm, host } = rig({ version: "tmux 3.5a" });
  await open(host, "trm_a1");
  await open(host, "trm_a2");
  tm.sessions.set("someone-elses", { name: "someone-elses", cols: 1, rows: 1, cwd: "/", lines: [], typed: "", hung: false, env: {} });
  assert.deepEqual(await host.health(), { ok: true, detail: "tmux 3.5a", sessions: 2 });
});

// ---- control mode

test("control mode: %output lines become frames with their octal escapes decoded; other control lines are not frames", () => {
  assert.equal(decodeControlOutput("hello\\015\\012"), "hello\r\n");
  assert.equal(decodeControlOutput("\\033[31mred\\033[0m"), "\u001b[31mred\u001b[0m");
  assert.equal(decodeControlOutput("a\\134b"), "a\\b");
  assert.equal(decodeControlOutput("caf\\303\\251 \\342\\230\\203"), "café ☃");
  assert.equal(decodeControlOutput("100\\0%"), "100\\0%", "an incomplete escape is left as it is");
  assert.equal(frameOf("%output %1 hi\\015\\012"), "hi\r\n");
  assert.equal(frameOf("%output %12 a b  c"), "a b  c");
  assert.equal(frameOf("%begin 1700000000 1 0"), null);
  assert.equal(frameOf("%session-changed $1 vyre-trm_a1"), null);
  assert.equal(frameOf("%extended-output %1 5 : x"), null);
});

test("stream: what the session prints reaches the listener as frames until it is stopped", async () => {
  const { tm, host } = rig();
  await open(host);
  const got: string[] = [];
  const stop = host.stream!("trm_a1", (t) => got.push(t));
  tm.write("vyre-trm_a1", "building");
  tm.write("vyre-trm_a1", "done é");
  stop();
  tm.write("vyre-trm_a1", "after");
  assert.deepEqual(got, ["building\n", "done é\n"]);
  assert.equal(createTmuxHost({ exec: tm.exec }).stream, undefined, "no control client, no stream");
});

// ---- the module through the adapter

test("the module end to end on tmux: an agent's command, the person's typing, the screen read back, and closing", async () => {
  reset();
  const { tm, host } = rig({ scripts: { "npm test": { out: "2 passing", code: 0 }, ls: { out: "a\nb", code: 0 } } });
  bindHost(host);
  const hn = harness();
  const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
  const agent = hn.as({ kind: "agent", id: "agt_intake" }, "usr_dana", "run_1");
  const r = await h["terminal.run"]!(agent, { command: "npm test", idempotencyKey: "k1" });
  assert.deepEqual(contractErrors("terminal.run", "out", r), []);
  assert.deepEqual([r.exitCode, r.output, r.truncated], [0, "2 passing", false]);
  const sessions = [...tm.sessions.keys()];
  assert.deepEqual(sessions, [`vyre-${r.terminalId}`]);

  assert.deepEqual(await h["terminal.input"]!(hn.ctx, { terminalId: r.terminalId, data: "ls\r" }), { ok: true });
  const read = await h["terminal.read"]!(hn.ctx, { terminalId: r.terminalId, lines: 50 });
  assert.match(read.text, /2 passing/);
  const att = await h["terminal.attach"]!(hn.ctx, { terminalId: r.terminalId });
  assert.match(att.replay, /2 passing/);
  assert.equal(tm.sessions.size, 1, "attaching did not start another session");

  const st = await h["terminal.status"]!(hn.ctx, { terminalIds: [r.terminalId] });
  assert.equal(st.rows[0].state, "idle");
  assert.equal((await h["terminal.health"]!(hn.ctx, {})).state, "healthy");
  await h["terminal.close"]!(hn.ctx, { terminalId: r.terminalId });
  assert.equal(tm.sessions.size, 0);
  assert.equal(codeOf(await h["terminal.read"]!(hn.ctx, { terminalId: r.terminalId }).catch((e: unknown) => e)), "validation.not_found");
});
