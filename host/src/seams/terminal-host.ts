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
  /** Agent workspaces on this machine, when it can run them (modules/terminal/impl.ts WorkspaceConfig). */
  workspaces?: WorkspacesConfig;
}

/** Where Docker is and which image is the agent workspace; the module builds the manager from it (agent workspaces, 6 Nov). */
export interface WorkspacesConfig {
  /** The Docker Engine socket. Default /var/run/docker.sock. */
  socketPath?: string;
  /** A Team server: the container runner's socket and its token, read again on each call. */
  runner?: { socket: string; token(): string };
  /** The workspace image of this release (VYRE_WORKSPACE_IMAGE, from images.lock). Default vyre/agent-workspace:1. */
  image?: string;
  /** Minutes of no use before a workspace sleeps, in ms. Default 10 minutes. */
  idleMs?: number;
  /** The mirror of each agent's folder in Files onto ~/Vyre in its workspace: the computers module's home sync and tar reader, made by the daemon as the agent principal. Omitted: no mirror. */
  home?: {
    sync(o: { agentId: string; computerId: string; fs: never; manifest: string }): { pass(): Promise<{ failed: number }> };
    readTar(tar: Uint8Array): never;
    manifest(agentId: string): string;
    /** The mirror of a project's shared folder with its folder in Files, every call as the named agent; null when the project has no folder. */
    syncProject?(o: { projectId: string; agentId: string; fs: never; manifest: string }): { pass(): Promise<{ failed: number }> } | null;
    projectManifest?(projectId: string): string;
    intervalMs?: number;
  };
  /** Room on the host: asked before a workspace starts, told when one stops (the computers module's capacity, over host calls). `nodeId` names a server that joined. Omitted: no limit but Docker's. */
  capacity?: {
    claim(agentId: string, nodeId?: string): Promise<{ state: "running" | "waiting"; line?: string }>;
    release(agentId: string, nodeId?: string): Promise<void>;
  };
  /** Servers that joined the Space, where an agent's workspace goes when the Space has no container runtime of its own (a Personal Space on a computer without Docker, or a server added for room). */
  nodes?: { ask(nodeId: string, kind: string, input: unknown, timeoutMs?: number): Promise<unknown>; place(agentId: string): Promise<string | null> };
  /** The projects an agent is on, so their shared folders are mounted. */
  projectsOf?(agentId: string): Promise<readonly string[]> | readonly string[];
  log?(level: "info" | "warn", msg: string, attrs?: Record<string, unknown>): void;
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
  /** Agent workspaces on this machine: given when it has a container runtime the Space may use (a Team server's runner or socket). Omitted: agents' commands go where their turn runs. */
  workspaces?: Omit<WorkspacesConfig, "image"> & { image?: string };
}

const KEEP = ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ"];

/** The environment a command starts with: who and where the person is, and nothing of the daemon's own. */
export function commandEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP) { const v = base[k]; if (typeof v === "string" && v !== "") out[k] = v; }
  out["TERM"] = "xterm-256color";
  // an app started from the Dock has a short PATH: tmux and the person's tools from Homebrew live here
  const dirs = (out["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":");
  for (const extra of ["/opt/homebrew/bin", "/usr/local/bin"]) if (!dirs.includes(extra) && fs.existsSync(extra)) dirs.push(extra);
  out["PATH"] = dirs.join(":");
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
  const workspaces: WorkspacesConfig | undefined = d.workspaces ? { ...d.workspaces, image: d.workspaces.image ?? (process.env["VYRE_WORKSPACE_IMAGE"] || "vyre/agent-workspace:1") } : undefined;
  return {
    ...(workspaces ? { workspaces } : {}),
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
