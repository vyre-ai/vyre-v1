// A terminal host over a real tmux server on a private socket, for the walks that need a real keyboard (colours, arrows, Tab, Ctrl-C, a hidden prompt). Needs tmux on the machine; the caller closes it with stop().
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTmuxHost } from "../../modules/terminal/impl.ts";
import type { Exec, ExecResult } from "../../modules/terminal/impl.ts";
import type { TerminalHost } from "../../modules/terminal/projections.ts";

const SOCK = `vyre-walk-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-walk-tmux-")));
const ENV: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: work, TERM: "xterm-256color", SHELL: "/bin/bash", LANG: "C.UTF-8", PS1: "$ " };

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
  argv[0] === "tmux" ? run("tmux", ["-L", SOCK, "-f", "/dev/null", ...argv.slice(1)], x?.stdin) : run(argv[0] as string, argv.slice(1), x?.stdin);

export const walkDir = work;
/** Every key the host was asked to press, in order, as it arrived (for a walk to compare with what was typed). */
export const keyLog: string[] = [];
export function realTmuxHost(): TerminalHost {
  const h = createTmuxHost({ exec, pollMs: 20 });
  return {
    ...h,
    async keys(id, ks) {
      keyLog.push(JSON.stringify(ks));
      return h.keys!(id, ks);
    },
  };
}
export async function stopRealTmux(): Promise<void> {
  await run("tmux", ["-L", SOCK, "-f", "/dev/null", "kill-server"]);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
