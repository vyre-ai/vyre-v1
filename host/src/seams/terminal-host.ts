// The terminal module's host seam: the module exports `hostSeams = { setTerminalHost }` and the daemon hands it this half. The module never spawns a process, so this machine's way of running
// tmux (and a plain shell where tmux is not installed, as on a Mac) comes from here, with which sessions live on this machine and where a person's turn runs.
//   runsHere   a terminal on the person's computer lives here when this daemon is that computer (the device role: the desktop app's own daemon, which also serves a Personal Space).
//              The Space server and agent computers are other paths and are not opened here.
//   place      where a person's turn runs, read as that person: engine.placement.decide and whether the agent has a computer, plus the person's computer this daemon is.
// A command runs with a small environment of its own (home, user, shell, path, language), never the daemon's, so nothing the daemon was started with reaches it.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

type Target = { host: "agent_computer" | "space_server" | "device"; agentId?: string; computerId?: string; deviceId?: string };
type ExecResult = { code: number; stdout: string; stderr: string };
type ShellRun = (a: { command: string; cwd: string; env: Readonly<Record<string, string>>; onData(text: string): void; signal: AbortSignal }) => Promise<{ exitCode: number | null }>;
export interface TurnPlaceShape { team: boolean; agentComputer: boolean; runsOn: "device" | "agent_computer" | "server" | "space"; deviceId?: string }

/** What the terminal module's setTerminalHost takes (modules/terminal/impl.ts TerminalHostSeam). */
export interface TerminalHostSeamShape {
  exec(argv: readonly string[]): Promise<ExecResult>;
  control(session: string, onLine: (line: string) => void): () => void;
  shell: ShellRun;
  home: string;
  runsHere(target: Target): boolean;
  place(a: { space: string; threadId?: string; agentId: string; person: string }): Promise<TurnPlaceShape | null>;
}

export interface TerminalHostDeps {
  /** This daemon's roles: "device" means it is a person's computer. */
  roles: readonly string[];
  /** A Team Space (anything but personal). */
  team: boolean;
  /** Run a read as this person through the invoke pipeline; null when it did not answer ok. */
  readAs(person: string, cap: string, input: unknown): Promise<unknown>;
  /** The person's computer as this Space knows it (their newest desktop app or daemon), when this daemon is it. */
  computerOf(person: string): string | undefined;
  /** Defaults: the environment and home folder of this process's user. */
  env?: NodeJS.ProcessEnv;
  home?: string;
}

const KEEP = ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ"];

/** The environment a command starts with: who and where the person is, and nothing of the daemon's own. */
export function commandEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP) { const v = base[k]; if (typeof v === "string" && v !== "") out[k] = v; }
  out["TERM"] = "xterm-256color";
  return out;
}

/** The shell and the arguments that run one line in it: a login shell, so the person's PATH (Homebrew and the like) is there even when the app was started from the Dock. */
export function shellArgv(env: Readonly<Record<string, string>>, command: string): [string, string[]] {
  const sh = env["SHELL"] && path.isAbsolute(env["SHELL"]) ? env["SHELL"] : fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
  const login = /\/(zsh|bash)$/.test(sh);
  return [sh, [...(login ? ["-l"] : []), "-c", command]];
}

export function createTerminalHostSeam(d: TerminalHostDeps): TerminalHostSeamShape {
  const env = commandEnv(d.env ?? process.env);
  const home = d.home ?? env["HOME"] ?? os.homedir();
  const device = d.roles.includes("device");
  return {
    exec(argv) {
      return new Promise((resolve) => {
        const [file, ...args] = argv;
        execFile(file ?? "tmux", args, { env, cwd: home, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
          const code = err ? (typeof (err as { code?: unknown }).code === "number" ? Number((err as { code: number }).code) : 127) : 0;
          resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (err && code === 127 ? `${file}: ${err.message}` : "") });
        });
      });
    },
    control(session, onLine) {
      const child = spawn("tmux", ["-C", "attach", "-t", session], { env, cwd: home, stdio: ["pipe", "pipe", "ignore"] });
      child.on("error", () => undefined);
      readline.createInterface({ input: child.stdout }).on("line", onLine);
      return () => { try { child.stdin.end(); child.kill(); } catch { /* already gone */ } };
    },
    shell: (a) => new Promise((resolve) => {
      if (!fs.existsSync(a.cwd)) { a.onData(`cd: no such folder: ${a.cwd}\n`); resolve({ exitCode: 1 }); return; }
      const full = { ...env, ...a.env };
      const [sh, args] = shellArgv(full, a.command);
      const child = spawn(sh, args, { cwd: a.cwd, env: full, stdio: ["ignore", "pipe", "pipe"], detached: true });
      const stop = (): void => {
        const pid = child.pid;
        if (pid === undefined) return;
        try { process.kill(-pid, "SIGINT"); } catch { /* it ended */ }
        setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { /* it ended */ } }, 2000).unref();
      };
      if (a.signal.aborted) stop(); else a.signal.addEventListener("abort", stop, { once: true });
      child.stdout.setEncoding("utf8").on("data", (t: string) => a.onData(t));
      child.stderr.setEncoding("utf8").on("data", (t: string) => a.onData(t));
      child.on("error", (e) => { a.onData(`${e.message}\n`); resolve({ exitCode: 127 }); });
      child.on("close", (code, signal) => { a.signal.removeEventListener("abort", stop); resolve({ exitCode: code ?? (signal ? 130 : null) }); });
    }),
    home,
    runsHere: (t) => t.host === "device" && device,
    async place(a) {
      const decided = a.threadId === undefined ? null
        : ((await d.readAs(a.person, "engine.placement.decide", { threadId: a.threadId, agentId: a.agentId, kind: "message" }).catch(() => null)) as { placement?: string; reason?: string; nodeId?: string } | null);
      const agent = (await d.readAs(a.person, "agents.get", { agentId: a.agentId }).catch(() => null)) as { agent?: { hasComputer?: boolean } } | null;
      // A turn the Space runs itself (no pin to a server, not the agent's computer) runs on this machine; when this daemon is the person's computer that is their computer.
      const runsOn: TurnPlaceShape["runsOn"] = decided?.reason === "agent_computer" ? "agent_computer" : decided?.nodeId ? "server" : decided?.placement === "device" || device ? "device" : "space";
      const deviceId = runsOn === "device" && device ? d.computerOf(a.person) : undefined;
      return { team: d.team, agentComputer: agent?.agent?.hasComputer === true, runsOn, ...(deviceId === undefined ? {} : { deviceId }) };
    },
  };
}
