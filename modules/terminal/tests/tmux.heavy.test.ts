// @heavy docker
// Real tmux (spec 2.7, ARCH 6.11, 7.2): the tmux adapter every host shares, run against a real tmux server on a private socket instead of the stand-in. A session opens at the size and folder asked for,
// keystrokes reach the shell, `run` frames a command with markers and reads its exit code back, resize reaches the shell, two viewers attach to one session and both see its output, a kill ends it,
// and a Vault value filled into a command is removed from everything a person can see (the result, the scrollback, the replay and the live stream) while the shell really did receive it.
//
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job in check.yml sets it and installs tmux). Without it every test here is skipped with its reason. With it on, a missing tmux fails the run.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTmuxHost, handlers, openFrames } from "../impl.ts";
import type { Exec, ExecResult } from "../impl.ts";
import { bindHost, bindTeam, bindValues, scrubberFor, spellingsFor } from "../projections.ts";
import { fakeValues, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts a tmux server)";

const SOCK = `vyre-heavy-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-tmux-heavy-")));
// The environment the tmux server and its shells get: nothing of the runner's but the search path.
const ENV: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", HOME: work, TERM: "xterm-256color", SHELL: "/bin/bash", LANG: "C.UTF-8", PS1: "$ " };
const TMUX = ["-L", SOCK, "-f", "/dev/null"];

function runTmux(args: readonly string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn("tmux", [...TMUX, ...args], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    p.stdin.on("error", () => undefined);
    p.stdin.end(stdin ?? "");
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
const exec: Exec = (argv, x) => runTmux(argv.slice(1), x?.stdin);

/** A control-mode client, as the live relay uses: `tmux -C attach`, one line at a time. */
function control(session: string, onLine: (line: string) => void): () => void {
  const p = spawn("tmux", [...TMUX, "-C", "attach", "-t", session], { env: ENV, stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { onLine(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); }
  });
  p.on("error", () => undefined);
  return () => { try { p.stdin.end(); } catch { /* already closed */ } p.kill(); };
}

const host = createTmuxHost({ exec, control, pollMs: 20 });
const open = (id: string, extra: { cwd?: string; cols?: number; rows?: number } = {}) =>
  host.open({ terminalId: id, target: { host: "space_server" }, name: "heavy", cols: extra.cols ?? 100, rows: extra.rows ?? 30, folders: [], ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }) });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(what: string, f: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!(await f())) { if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what}`); await sleep(25); }
}
const tmuxOut = async (...args: string[]): Promise<string> => (await runTmux(args)).stdout.trim();

before(async () => {
  if (!ON) return;
  const v = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  assert.equal(v.status, 0, "tmux is not installed on this runner");
});
after(async () => {
  if (ON) await runTmux(["kill-server"]);
  // kill-server accepts the shutdown before every shell/control client has
  // necessarily finished exiting. Those processes use `work` as HOME and can
  // race one last write with recursive removal, which Linux reports as
  // ENOTEMPTY. Node retries that transient class only when maxRetries is set.
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("tmux: open makes a real session at the size and in the folder asked for", { skip }, async () => {
  const sub = path.join(work, "site");
  fs.mkdirSync(sub);
  const r = await open("trm_hv1", { cwd: sub, cols: 100, rows: 30 });
  assert.equal(r.cwd, sub);
  assert.equal(await tmuxOut("display-message", "-p", "-t", "vyre-trm_hv1", "#{window_width}x#{window_height}"), "100x30");
  const st = await host.status(["trm_hv1", "trm_none"]);
  assert.equal(st[0]?.state, "idle");
  assert.equal(st[1]?.state, "exited", "a session that does not exist is exited");
  await assert.rejects(() => open("trm_hv1"), /duplicate session|failed/);
  const h = await host.health();
  assert.equal(h.ok, true);
  assert.match(h.detail, /^tmux /);
  assert.ok(h.sessions >= 1);
});

test("tmux: typed input reaches the shell, read returns the screen, and a cursor returns only what is new", { skip }, async () => {
  await open("trm_hv2");
  await host.input("trm_hv2", "echo typed-$((6*7))\r");
  await until("the shell's answer", async () => (await host.read("trm_hv2", { lines: 50 })).text.includes("typed-42"));
  const first = await host.read("trm_hv2", { lines: 200 });
  await host.input("trm_hv2", "echo second-$((7*7))\r");
  await until("the second answer", async () => (await host.read("trm_hv2", { lines: 200, since: first.next })).text.includes("second-49"));
  const fresh = await host.read("trm_hv2", { lines: 200, since: first.next });
  assert.equal(fresh.text.includes("typed-42"), false, "a cursor skips what was already read");
  // Ctrl-C ends a running command and the prompt comes back.
  await host.input("trm_hv2", "sleep 60\r");
  await until("sleep to run", async () => (await host.status(["trm_hv2"]))[0]?.state === "running");
  await host.interrupt("trm_hv2");
  await until("the prompt to come back", async () => (await host.status(["trm_hv2"]))[0]?.state === "idle");
});

test("tmux: run frames a command with markers, returns its exit code and output, keeps variables out of the session, and a timeout leaves the session usable", { skip }, async () => {
  await open("trm_hv3");
  const a = await host.run("trm_hv3", { command: "printf 'one\\ntwo\\n'; sh -c 'exit 3'", env: {}, timeoutMs: 8000 });
  assert.deepEqual([a.exitCode, a.output, a.truncated], [3, "one\ntwo", false]);
  assert.ok(a.durationMs >= 0);

  const withEnv = await host.run("trm_hv3", { command: 'printf %s "$HV_NAME"', env: { HV_NAME: "it's \"quoted\"; $(touch /tmp/hv-pwned)" }, timeoutMs: 8000 });
  assert.equal(withEnv.output, `it's "quoted"; $(touch /tmp/hv-pwned)`, "a value is data, never a command");
  assert.equal(fs.existsSync("/tmp/hv-pwned"), false);
  const unset = await host.run("trm_hv3", { command: 'printf "[%s]" "$HV_NAME"', env: {}, timeoutMs: 8000 });
  assert.equal(unset.output, "[]", "the variable lived in a subshell");

  const sub = path.join(work, "cwd-here");
  fs.mkdirSync(sub);
  assert.equal((await host.run("trm_hv3", { command: "pwd", cwd: sub, env: {}, timeoutMs: 8000 })).output, sub);
  await host.run("trm_hv3", { command: `cd ${sub}`, env: {}, timeoutMs: 8000 });
  assert.equal((await host.run("trm_hv3", { command: "pwd", env: {}, timeoutMs: 8000 })).output, sub, "cd stays in the session, like typing it");

  const spoof = await host.run("trm_hv3", { command: "echo __VYRE_END_000000000000__:0; echo real; false", env: {}, timeoutMs: 8000 });
  assert.equal(spoof.exitCode, 1, "output that looks like a marker is not one");

  const t0 = Date.now();
  await assert.rejects(() => host.run("trm_hv3", { command: "sleep 60", env: {}, timeoutMs: 700 }), (e: unknown) => (e as { code?: string }).code === "timeout");
  assert.ok(Date.now() - t0 < 5000, "gave up at the deadline");
  const alive = await host.run("trm_hv3", { command: "echo alive", env: {}, timeoutMs: 8000 });
  assert.deepEqual([alive.exitCode, alive.output], [0, "alive"]);
});

test("tmux: resize reaches the window and the shell", { skip }, async () => {
  await open("trm_hv4", { cols: 100, rows: 30 });
  await host.resize("trm_hv4", 80, 24);
  assert.equal(await tmuxOut("display-message", "-p", "-t", "vyre-trm_hv4", "#{window_width}x#{window_height}"), "80x24");
  const size = await host.run("trm_hv4", { command: "stty size", env: {}, timeoutMs: 8000 });
  assert.equal(size.output, "24 80", "the shell's own idea of the screen");
});

test("tmux: two viewers attach to one session and both see its output; one leaving does not stop the other", { skip }, async () => {
  await open("trm_hv5");
  assert.ok(host.stream, "the adapter has a live stream");
  const a: string[] = [], b: string[] = [];
  const stopA = host.stream!("trm_hv5", (f) => a.push(f));
  const stopB = host.stream!("trm_hv5", (f) => b.push(f));
  await sleep(300);
  await host.input("trm_hv5", "echo viewer-line-$((1+1))\r");
  await until("both viewers to see line 2", () => a.join("").includes("viewer-line-2") && b.join("").includes("viewer-line-2"));
  stopA();
  const sawBefore = a.join("").length;
  await host.input("trm_hv5", "echo viewer-line-$((2+1))\r");
  await until("the remaining viewer to see line 3", () => b.join("").includes("viewer-line-3"));
  await sleep(200);
  assert.equal(a.join("").length, sawBefore, "the viewer that left gets nothing more");
  assert.equal(a.join("").includes("viewer-line-3"), false);
  stopB();
  // The session outlived both: a third viewer sees the same screen on attach.
  assert.match((await host.read("trm_hv5", { lines: 100 })).text, /viewer-line-3/);
});

test("tmux: a kill ends the session, closing twice is fine, and the server reports it gone", { skip }, async () => {
  await open("trm_hv6");
  await host.close("trm_hv6");
  assert.notEqual((await runTmux(["has-session", "-t", "vyre-trm_hv6"])).code, 0);
  assert.equal((await host.status(["trm_hv6"]))[0]?.state, "exited");
  await host.close("trm_hv6");
  await assert.rejects(() => host.input("trm_hv6", "x"), /failed/);
});

// ---- Vault values -----------------------------------------------------------------------------------------------------------------------------------

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const AGENT = { kind: "agent" as const, id: "agt_intake" };

test("tmux: a Vault value filled into a command is removed from the result, the scrollback, the replay and the live stream, while the shell really received it", { skip }, async () => {
  const SECRET = `sk-live-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  reset();
  bindHost(host);
  bindTeam(() => true);
  bindValues(fakeValues({ "#Dana_Api.key": SECRET }));
  const hn = harness();
  const agent = hn.as(AGENT, "usr_dana", "run_7");
  const person = hn.ctx;
  try {
    const opened = await h["terminal.open"]!(person, { host: "agent_computer", agentId: "agt_intake", name: "keys", idempotencyKey: "hv-open" });
    const terminalId = opened.terminal.terminalId as string;
    const session = `vyre-${terminalId}`;

    // The command receives the value in its environment and prints it, as a careless tool would.
    const r = await h["terminal.run"]!(agent, { terminalId, command: 'echo "token=$K"; printf %s "$K" | wc -c', env: { K: "#Dana_Api.key" }, idempotencyKey: "hv-run" });
    assert.equal(r.exitCode, 0);
    assert.equal(r.output.includes(SECRET), false, "the result an agent gets back");
    assert.match(r.output, /token=\[#Dana_Api\.key\]/);
    assert.match(r.output, new RegExp(String(SECRET.length)), "the command did get the real value (it counted its length)");

    // The terminal itself held it: this is what makes the scrub mean something.
    const raw = (await runTmux(["capture-pane", "-p", "-J", "-t", session, "-S", "-500"])).stdout;
    assert.ok(raw.includes(SECRET), "the command printed it on the real screen");

    const read = await h["terminal.read"]!(person, { terminalId, lines: 200 });
    assert.equal(read.text.includes(SECRET), false, "the scrollback a person reads");
    const att = await h["terminal.attach"]!(person, { terminalId });
    assert.equal(att.replay.includes(SECRET), false, "the replay when a tab opens");

    // Live: a typed value, in pieces so that a frame boundary can cut it in two.
    const got: string[] = [];
    // what the host's own stream delivers, before the relay scrubs it: kept for the failure message (the relay's holdback is the thing under test)
    const hostFrames: string[] = [];
    const stopRaw = host.stream!(terminalId, (frame) => hostFrames.push(frame));
    const live = await openFrames(hn.db, att.ticket, hn.clock.t, (t) => got.push(t));
    assert.ok(live, "the ticket opens a live connection");
    await sleep(300);
    await h["terminal.input"]!(person, { terminalId, data: `echo ${SECRET.slice(0, 11)}` });
    await sleep(300);
    await h["terminal.input"]!(person, { terminalId, data: `${SECRET.slice(11)}\r` });
    await until("the scrubbed value in the stream", () => got.join("").includes("[#Dana_Api.key]"));
    const seen = got.join("");
    assert.equal(seen.includes(SECRET), false, `the stream never shows the value; frames the tab was sent: ${JSON.stringify(got.map((g) => g.replaceAll(SECRET, "<SECRET>")))}; frames the host delivered: ${JSON.stringify(hostFrames.map((g) => g.replaceAll(SECRET, "<SECRET>")))}; secret length ${SECRET.length}, spellings ${spellingsFor(terminalId).map((x) => x.length).join(",")}, scrubber ${scrubberFor(terminalId) ? "bound" : "none"}`);
    assert.equal(seen.includes(SECRET.slice(0, 11) + SECRET.slice(11, 16)), false, "nor most of it");
    live!.close(); stopRaw();
    const screenAfter = (await runTmux(["capture-pane", "-p", "-J", "-t", session, "-S", "-500"])).stdout;
    assert.ok(screenAfter.includes(SECRET), "and the shell did receive the value, in pieces");
  } finally { reset(); }
});

test("tmux (W6): a person's value used through a team agent is never typed, never in history, and another person asking the same agent for history, env, the first tab's scrollback or the shell's /proc gets nothing", { skip }, async () => {
  const SECRET = `sk-live-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  // a value that would run as shell if it were pasted into the line
  const EVIL = "a$b;touch $HOME/vyre-pwned;'q\"x";
  reset();
  bindHost(host);
  bindTeam(() => true);
  bindValues(fakeValues({ "#Dana_Api.key": SECRET, "#Db.password": EVIL }));
  const hn = harness();
  const dana = hn.as(AGENT, "usr_dana", "run_a");
  const omar = hn.as(AGENT, "usr_omar", "run_b");
  try {
    // Dana's turn: the value in env, and a handle inside the command line itself
    const a = await h["terminal.run"]!(dana, { session: "dana", command: 'printf %s "$K" | wc -c; printf %s #Db.password | wc -c; echo "seen=$K"', env: { K: "#Dana_Api.key" }, idempotencyKey: "w6-a" });
    assert.equal(a.exitCode, 0, a.output);
    const counts = a.output.split("\n").map((l: string) => l.trim());
    assert.deepEqual(counts.slice(0, 2), [String(SECRET.length), String(Buffer.byteLength(EVIL))], "both values reached the command exactly");
    assert.equal(fs.existsSync(path.join(work, "vyre-pwned")), false, "the value did not run as shell");
    const sessA = `vyre-${a.terminalId}`;
    const pane = (await tmuxOut("display-message", "-p", "-t", sessA, "#{pane_pid}"));

    // nothing typed holds a value: the raw screen shows the line, which names variables only (the command's own echo is the only place the value is)
    const raw = (await runTmux(["capture-pane", "-p", "-J", "-t", sessA, "-S", "-"])).stdout;
    const typedLine = raw.split("\n").find((l) => l.includes("__VYRE_BEG_") && l.includes("printf"));
    assert.ok(typedLine, raw.replaceAll(SECRET, "<S>"));
    assert.equal(typedLine!.includes(SECRET) || typedLine!.includes(EVIL), false, "the typed line holds no value");
    assert.equal((await runTmux(["list-buffers"])).stdout.includes("vyre-env"), false, "the values' buffer is gone");

    // Omar's turn, same agent, another tab of the same workspace
    const asks = [
      "history",
      `tmux capture-pane -p -J -t ${sessA} -S -`,
      `cat /proc/${pane}/environ | tr '\\0' '\\n'`,
      "env",
      "tmux list-buffers; tmux save-buffer - 2>/dev/null; true",
    ];
    for (const [i, command] of asks.entries()) {
      const r = await h["terminal.run"]!(omar, { session: "omar", command, idempotencyKey: `w6-b${i}` });
      assert.equal(r.output.includes(SECRET) || r.output.includes(EVIL), false, `Omar's ${command}: ${r.output.replaceAll(SECRET, "<S>").replaceAll(EVIL, "<E>").slice(-400)}`);
    }
    const scrolled = await h["terminal.run"]!(omar, { session: "omar", command: `tmux capture-pane -p -J -t ${sessA} -S -`, idempotencyKey: "w6-b9" });
    assert.match(scrolled.output, /seen=\[#Dana_Api\.key\]/, "the first tab's output, scrubbed");

    // Dana's tab closes: bash writes its history on the hangup. No agent line is in it, so no value either.
    await h["terminal.close"]!(hn.ctx, { terminalId: a.terminalId });
    await until("the first tab to end", async () => (await runTmux(["has-session", "-t", sessA])).code !== 0);
    await sleep(300);
    const histFile = path.join(work, ".bash_history");
    const hist = fs.existsSync(histFile) ? fs.readFileSync(histFile, "utf8") : "";
    assert.equal(hist.includes(SECRET) || hist.includes(EVIL) || hist.includes("__VYRE_BEG_"), false, `history on disk: ${hist.replaceAll(SECRET, "<S>").slice(-400)}`);
    const later = await h["terminal.run"]!(omar, { session: "omar", command: "cat ~/.bash_history 2>/dev/null; true", idempotencyKey: "w6-c" });
    assert.equal(later.output.includes(SECRET), false);
  } finally { reset(); }
});

test("tmux (review 3, 5): a values buffer an earlier daemon left is removed, a busy tab is refused, a tab with set -x on shows no value, and the window in which a buffer exists is measured", { skip }, async (t) => {
  const PART = `vq${Math.random().toString(36).slice(2, 10)}`;
  const VALUE = `it's ${PART}\nsecond "line" $(id)`;
  await open("trm_hv7");
  // a daemon that died between load and delete left this
  await runTmux(["load-buffer", "-b", "vyre-env-00leftover", "-"], "export K='left-behind-value'\n");
  const r1 = await host.run("trm_hv7", { command: 'printf %s "$K" | wc -c', env: { K: VALUE }, timeoutMs: 8000 });
  assert.equal(r1.output.trim(), String(Buffer.byteLength(VALUE)));
  assert.equal((await runTmux(["list-buffers", "-F", "#{buffer_name}"])).stdout.includes("vyre-env-"), false, "no values buffer is left, the old one included");

  // xtrace and verbose on in the tab: the run's subshell turns them off before it touches a value
  await host.input("trm_hv7", "set -xv\r");
  await sleep(200);
  const r2 = await host.run("trm_hv7", { command: 'printf %s "$K" | wc -c', env: { K: VALUE }, timeoutMs: 8000 });
  assert.equal(r2.output.includes(PART), false, r2.output);
  const raw = (await runTmux(["capture-pane", "-p", "-J", "-t", "vyre-trm_hv7", "-S", "-"])).stdout;
  assert.equal(raw.includes(PART), false, `the screen, with set -xv on: ${raw.slice(-600)}`);
  await host.input("trm_hv7", "set +xv\r");

  // the window: a watcher asks the tmux server for its buffers as fast as it can while a run hands over its values
  const seen = path.join(work, "seen.txt");
  const watcher = spawn("bash", ["-c", `while :; do tmux -L ${SOCK} list-buffers -F '#{buffer_name}' 2>/dev/null | grep -q vyre-env- && date +%s%N >> ${seen}; done`], { env: ENV, stdio: "ignore" });
  try {
    for (let i = 0; i < 10; i++) await host.run("trm_hv7", { command: "true", env: { K: VALUE }, timeoutMs: 8000 });
  } finally { watcher.kill("SIGKILL"); }
  const stamps = fs.existsSync(seen) ? fs.readFileSync(seen, "utf8").trim().split("\n").filter(Boolean).map((x) => Number(BigInt(x) / 1_000_000n)) : [];
  // runs of stamps less than 30 ms apart are one window
  const windows: number[] = [];
  for (let i = 0, start = 0; i < stamps.length; i++) if (i === stamps.length - 1 || stamps[i + 1]! - stamps[i]! > 30) { windows.push(stamps[i]! - stamps[start]!); start = i + 1; }
  t.diagnostic(`values buffer seen by a polling watcher in ${windows.length} of 10 runs; longest window seen ${windows.length ? Math.max(...windows) : 0} ms`);
  assert.equal((await runTmux(["list-buffers", "-F", "#{buffer_name}"])).stdout.includes("vyre-env-"), false);

  // a tab that runs something: no values are loaded and nothing is typed into the program
  await host.input("trm_hv7", "sleep 30\r");
  await until("sleep to run", async () => (await host.status(["trm_hv7"]))[0]?.state === "running");
  await assert.rejects(() => host.run("trm_hv7", { command: "true", env: { K: VALUE }, timeoutMs: 3000 }), /still running something/);
  assert.equal((await runTmux(["list-buffers", "-F", "#{buffer_name}"])).stdout.includes("vyre-env-"), false);
  await host.interrupt("trm_hv7");
});
