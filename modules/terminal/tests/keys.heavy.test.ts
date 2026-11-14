// @heavy docker
// A person's keys on a real tmux (lead ruling, 14 Nov): the full-screen terminal draws tmux's own screen with its colours and sends keys raw, so a program that wants a real keyboard gets one: arrows, Enter,
// Tab, Ctrl-C, a pasted code, a hidden prompt. What is typed at a hidden prompt is never printed, so the screen, the scrollback, the pipe a log is written from and the agent's read never have it
// (AGENT-COMPUTER-2026-11-13.md section 11 point 6). The key-to-screen delay is measured and printed. Runs only with VYRE_HEAVY_DOCKER=1; with it on, a missing tmux fails the run.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTmuxHost } from "../impl.ts";
import type { Exec, ExecResult } from "../impl.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts a tmux server)";
const SOCK = `vyre-keys-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-keys-heavy-")));
const ENV: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
  HOME: work,
  TERM: "xterm-256color",
  SHELL: "/bin/bash",
  LANG: "C.UTF-8",
  PS1: "$ ",
};
const TMUX = ["-L", SOCK, "-f", "/dev/null"];
function run(cmd: string, args: readonly string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn(cmd, [...args], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    p.stdin.on("error", () => undefined);
    p.stdin.end(stdin ?? "");
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
const exec: Exec = (argv, x) =>
  argv[0] === "tmux"
    ? run("tmux", [...TMUX, ...argv.slice(1)], x?.stdin)
    : run(argv[0] as string, argv.slice(1), x?.stdin);
const host = createTmuxHost({ exec, pollMs: 20 });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(what: string, f: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what}`);
    await sleep(15);
  }
}
const screen = async (id: string): Promise<string> => (await host.capture!(id, { lines: 200 })).text;
const open = (id: string) =>
  host.open({
    terminalId: id,
    target: { host: "space_server" },
    name: "keys",
    cols: 100,
    rows: 30,
    folders: [],
    cwd: work,
  });

before(() => {
  if (!ON) return;
  assert.equal(spawnSync("tmux", ["-V"], { encoding: "utf8" }).status, 0, "tmux is not installed on this runner");
});
after(async () => {
  if (ON) await run("tmux", [...TMUX, "kill-server"]);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("capture draws tmux's own screen with its colours, the cursor and the history", { skip }, async () => {
  await open("c1");
  await host.keys!("c1", [{ text: "printf '\\033[31mred\\033[0m plain\\n'" }, { key: "Enter" }]);
  await until("the coloured line", async () => (await screen("c1")).includes("plain"));
  const r = await host.capture!("c1", { lines: 200 });
  assert.match(r.text, /\x1b\[31mred\x1b\[0?m? ?plain|\x1b\[31mred/);
  assert.deepEqual([r.cols, r.rows], [100, 30]);
  assert.ok(r.cursor !== null && r.cursor.y >= 1);
  assert.equal(r.hidden, false, "a shell prompt echoes");
});

test(
  "keys: text, named keys, Tab, arrows, Ctrl-C and a multi-line paste reach the shell as a keyboard does",
  { skip },
  async () => {
    await open("k1");
    await host.keys!("k1", [{ text: "echo one" }, { key: "Enter" }]);
    await until("one", async () => /\none\b/.test(await screen("k1")));
    // history with Up, edit with Left and BSpace: a real line editor is driving this
    await host.keys!("k1", [{ text: "echo ab" }, { key: "Left" }, { key: "BSpace" }, { text: "X" }, { key: "Enter" }]);
    await until("the edited line", async () => /\nXb\b/.test(await screen("k1")));
    // Tab completes a file name
    fs.writeFileSync(path.join(work, "unique-file-name.txt"), "x");
    await host.keys!("k1", [{ text: "ls unique-f" }, { key: "Tab" }, { key: "Enter" }]);
    await until("the completed name", async () => (await screen("k1")).includes("unique-file-name.txt"));
    // Ctrl-C stops a running program
    await host.keys!("k1", [{ text: "sleep 100" }, { key: "Enter" }]);
    await sleep(200);
    await host.keys!("k1", [{ key: "C-c" }]);
    await host.keys!("k1", [{ text: "echo back" }, { key: "Enter" }]);
    await until("the shell is back after Ctrl-C", async () => /\nback\b/.test(await screen("k1")));
    // a paste is one write: two lines arrive whole, quotes and a semicolon at the end included
    await host.keys!("k1", [{ paste: "echo 'p1;'\necho p2;\n" }]);
    await until(
      "both pasted lines ran",
      async () => /\np1;/.test(await screen("k1")) && /\np2\b/.test(await screen("k1")),
    );
    await assert.rejects(() => host.keys!("k1", [{ key: "rm -rf /" }]), /not one a terminal takes/);
    await assert.rejects(() => host.keys!("k1", [{ key: "Enter; kill-server" }]), /not one a terminal takes/);
  },
);

test(
  "a hidden prompt: the typed secret is never on the screen, in the scrollback, in the log pipe or in a read; the program still gets it",
  { skip },
  async () => {
    await open("h1");
    const log = path.join(work, "h1.log");
    // the pipe a stored log is written from: everything the pane prints goes here
    await run("tmux", [...TMUX, "pipe-pane", "-t", "vyre-h1", `cat >> ${log}`]);
    const got = path.join(work, "got.txt");
    await host.keys!("h1", [
      { text: `read -s -p 'Passphrase: ' P; printf '%s' "$P" > ${got}; echo; echo $((6*7))` },
      { key: "Enter" },
    ]);
    await until(
      "the capture says the prompt is hidden",
      async () => (await host.capture!("h1", { lines: 200 })).hidden,
    );
    const SECRET = "hunter2-correct-horse";
    await host.keys!("h1", [{ text: SECRET }]);
    const mid = await host.capture!("h1", { lines: 200 });
    assert.ok(!mid.text.includes(SECRET) && !mid.text.includes("hunter2"), "not on the screen while typed");
    await host.keys!("h1", [{ key: "Enter" }]);
    await until("the program finished", async () => /\n42\b/.test(await screen("h1")));
    assert.equal(fs.readFileSync(got, "utf8"), SECRET, "the program really received it");
    const after = await host.capture!("h1", { lines: 5000 });
    assert.ok(!after.text.includes("hunter2"), "not in the scrollback");
    assert.ok(!(await host.read("h1", { lines: 5000 })).text.includes("hunter2"), "not in what the agent reads");
    await sleep(300);
    assert.ok(!fs.readFileSync(log, "utf8").includes("hunter2"), "not in the log pipe");
    assert.equal(after.hidden, false, "the prompt is back to echoing");
  },
);

test("early typing: until the program has really turned echo off, hidden is false (the bar says nothing reassuring), and it turns true only once echo is off", { skip }, async () => {
  await open("e1");
  // the program sleeps before it asks: for two seconds the terminal echoes whatever is typed, so nothing is hidden
  await host.keys!("e1", [{ text: "sleep 2; read -s -p 'Pass: ' P; echo; echo done-$((1+1))" }, { key: "Enter" }]);
  await sleep(300);
  assert.equal((await host.capture!("e1", { lines: 50 })).hidden, false, "the program is not reading yet: echo is on");
  await host.keys!("e1", [{ text: "typed-too-early" }]);
  assert.equal((await host.capture!("e1", { lines: 50 })).hidden, false, "still echoing: not hidden");
  await until("echo really off at the prompt", async () => (await host.capture!("e1", { lines: 50 })).hidden);
  const at = await host.capture!("e1", { lines: 50 });
  assert.ok(at.hidden && at.text.includes("Pass:"), "hidden only at the prompt");
});

test("key to screen: the delay from sending a key to seeing it on tmux's screen, measured", { skip }, async () => {
  await open("m1");
  const times: number[] = [];
  for (let i = 0; i < 25; i++) {
    const ch = String.fromCharCode(97 + (i % 26));
    const t0 = performance.now();
    await host.keys!("m1", [{ text: ch }]);
    for (;;) {
      const r = await host.capture!("m1", { lines: 30 });
      if (r.text.includes("abcdefghijklmnopqrstuvwxy".slice(0, i + 1))) break;
      if (performance.now() - t0 > 3000) assert.fail("the key never showed");
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)]!;
  console.log(
    `KEY_TO_SCREEN median ${med.toFixed(0)} ms, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms (send-keys then capture-pane, one process each)`,
  );
  assert.ok(med < 150, `median ${med.toFixed(0)} ms is over 150 ms`);
});
