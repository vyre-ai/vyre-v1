// @heavy docker
// The run script against a real tmux (impl.ts RUN_SCRIPT, TmuxOptions.oneExec; lane r42-computer): the same answers as the polling loop for real shells, the real exit codes, a command that moves the cursor, a
// long output whose whole history comes back, a timeout and a stop that end the wait. Runs only with VYRE_HEAVY_DOCKER=1 (and tmux, sh, date and grep installed), like tmux.heavy.test.ts.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTmuxHost, STOPPED_LINE } from "../impl.ts";
import type { Exec, ExecResult } from "../impl.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1";
const SOCK = `vyre-oneexec-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-oneexec-")));
// the script calls plain `tmux`: a shim on the path sends it to this test's own server
const shim = path.join(work, "bin");
fs.mkdirSync(shim);
// the workspace image's own history limit (its tmux.conf keeps 20,000 lines; a plain tmux keeps 2,000, which scrolls the first line of a 5,000-line output away and leaves no whole history to keep)
const CONF = path.join(work, "tmux.conf");
fs.writeFileSync(CONF, "set -g history-limit 20000\n");
fs.writeFileSync(path.join(shim, "tmux"), `#!/bin/sh\nexec "$REAL_TMUX" -L ${SOCK} -f ${CONF} "$@"\n`, {
  mode: 0o755,
});
const REAL_TMUX =
  (process.env["PATH"] ?? "")
    .split(":")
    .map((d) => path.join(d, "tmux"))
    .find((p) => fs.existsSync(p)) ?? "/usr/bin/tmux";
const ENV: NodeJS.ProcessEnv = {
  PATH: `${shim}:${process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`,
  REAL_TMUX,
  HOME: work,
  TERM: "xterm-256color",
  SHELL: "/bin/bash",
  LANG: "C.UTF-8",
  PS1: "$ ",
};
const spawnIt = (cmd: string, args: readonly string[], stdin?: string): Promise<ExecResult> =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    p.stdin.on("error", () => undefined);
    p.stdin.end(stdin ?? "");
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => resolve({ code: 127, stdout, stderr: e.message }));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
// every exec goes through the shim on the path, so `tmux` (as an argument or inside the script) is this test's server
const exec: Exec = (argv, x) => spawnIt(argv[0] as string, argv.slice(1), x?.stdin);
after(async () => {
  if (ON) await spawnIt("tmux", ["kill-server"]);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

const mk = (oneExec: boolean) => createTmuxHost({ exec, pollMs: 20, oneExec });
const open = (host: ReturnType<typeof mk>, id: string) =>
  host.open({ terminalId: id, target: { host: "space_server" }, name: "heavy", cols: 100, rows: 30, folders: [] });
const run = (host: ReturnType<typeof mk>, id: string, command: string, timeoutMs = 20_000, signal?: AbortSignal) =>
  host.run(id, { command, env: {}, timeoutMs, ...(signal ? { signal } : {}) });

test(
  "the script answers what the loop answers for real shells: output, exit codes, a cd that stays, and the cursor moved up",
  { skip, timeout: 60_000 },
  async () => {
    const a = mk(false);
    const b = mk(true);
    await open(a, "trm_loop");
    await open(b, "trm_script");
    for (const command of [
      "echo hello",
      "false",
      "exit_code() { return 7; }; exit_code",
      "printf 'a\\nb\\nc'",
      "ls /nonexistent-dir",
      "cd /tmp && pwd",
      "pwd",
      "printf 'one\\ntwo\\n'; printf '\\033[2Atwo-over'",
    ]) {
      const x = await run(a, "trm_loop", command);
      const y = await run(b, "trm_script", command);
      // a command that moves the cursor back up rewrites a line and leaves the one under it: whether that line is in the answer depends on the moment the screen is read (the polling loop and the script were seen to
      // answer "two-over" and "two-over\ntwo" in either order across runs of the same command), so for that one command both must carry the rewritten line first and the same exit code; for every other
      // command the two answers are equal
      if (command.includes("two-over")) {
        assert.equal(y.exitCode, x.exitCode, command);
        assert.ok(
          y.output.startsWith("two-over") && x.output.startsWith("two-over"),
          `${command}: ${JSON.stringify([x.output, y.output])}`,
        );
        continue;
      }
      assert.deepEqual(
        { exitCode: y.exitCode, output: y.output, truncated: y.truncated },
        { exitCode: x.exitCode, output: x.output, truncated: x.truncated },
        command,
      );
    }
  },
);

test(
  "a long output: the answer is cut to its tail and the kept copy is the whole history from the command's first line",
  { skip, timeout: 60_000 },
  async () => {
    const h = createTmuxHost({ exec, pollMs: 20, oneExec: true, maxOutput: 2000 });
    await open(h, "trm_long");
    const r = await run(h, "trm_long", "seq 1 5000");
    assert.equal(r.exitCode, 0);
    assert.equal(r.output.length, 2000);
    assert.equal(r.truncated, true);
    assert.ok(r.full !== undefined);
    // the pane's history limit decides how much is there (a plain tmux keeps 2,000 lines; the workspace image's tmux.conf 20,000)
    assert.ok(r.full!.endsWith("5000"));
    assert.ok(r.full!.split("\n").length > r.output.split("\n").length);
  },
);

test(
  "a deadline ends the wait with Ctrl-C and the session works after; a stopped turn ends it at once with 130",
  { skip, timeout: 60_000 },
  async () => {
    const h = mk(true);
    await open(h, "trm_end");
    await assert.rejects(
      () => run(h, "trm_end", "sleep 30", 1500),
      (e: unknown) => (e as { code?: string }).code === "timeout",
    );
    assert.equal((await run(h, "trm_end", "echo back")).output, "back");
    const ac = new AbortController();
    const p = run(h, "trm_end", "sleep 30", 20_000, ac.signal);
    setTimeout(() => ac.abort(), 700);
    const t0 = Date.now();
    const r = await p;
    assert.equal(r.exitCode, 130);
    assert.ok(r.output.endsWith(STOPPED_LINE));
    assert.ok(Date.now() - t0 < 10_000, "ended at once, not at the deadline");
    assert.equal((await run(h, "trm_end", "echo again")).output, "again");
  },
);
