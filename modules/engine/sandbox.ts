// The sandbox around a CLI engine (P-L2_23, security review S8 finding 1). A CLI engine (Claude Code, Codex, Grok) is a program the daemon starts; without a wrap it can read every file the
// daemon's user can read. This builds the `wrap` the local launcher takes, so the engine runs in the person's sandbox: Seatbelt on a Mac, bubblewrap with the network wall on Linux. It lives here
// because agent code may not import the sandbox package.
//   - The working folder is one folder per person and thread under the Space data directory. It is the first read-write mount (bwrap does --chdir to the first mount) and the process's cwd.
//   - bwrap starts with --clearenv, so the spawn's environment (the key, VYRE_MCP_TOKEN) is copied into the sandbox spec and travels as --setenv. Seatbelt inherits the environment, so the proxy
//     variables are put in front of the command with env(1).
//   - Where the engine has to run in the person's container (host placement, Windows without WSL) there is no local wrap: the spawn fails with sandbox.unavailable and never falls back to the
//     unwrapped launcher.
import fs from "node:fs";
import path from "node:path";
import { SandboxError, bwrapWallCommand, proxyEnv, seatbeltCommand } from "../../sandbox/src/index.ts";
import type { Roots, SandboxSpec } from "../../sandbox/src/index.ts";
import { toWslPath, wslExe } from "../../sandbox/src/wsl/wsl.ts";
import type { AgentOptions, WslAgent } from "../../sandbox/src/wsl/wsl.ts";
import type { LocalLauncherOptions } from "../../agent/src/drivers/cli/launcher.ts";
import { labelLow, lowrunArgv } from "../../sandbox/src/win/lowrun.ts";

/** What the host knows about the sandbox it runs a CLI engine in. The wall (egress proxy) is started by the host and outlives the turns. */
export type EngineSandbox =
  | { kind: "bwrap"; wallDir: string; programRead?: readonly string[]; node?: string }
  | { kind: "seatbelt"; proxyPort: number; programRead?: readonly string[] }
  /** Windows: bwrap and the net wall inside Vyre's WSL2 distribution (sandbox/src/wsl). Paths are Windows paths here and become the VM's (/mnt/c/...) in the wrap. */
  | { kind: "wsl"; distro: string; user: string; agent: WslAgent; wall: AgentOptions["wall"]; programRead?: readonly string[]; vmPath?: (p: string) => string }
  /**
   * Windows, Personal Space (owner ruling 3 Nov 2026): the engine at Low integrity in a Job Object (sandbox/src/win/lowrun.cs). It may change only its work folder, its scratch home and temp, and
   * `writable` (the folders the person added to Vyre); it reads the computer as Claude Code does. Its network is the egress proxy on loopback, by its variables.
   */
  | { kind: "lowil"; helper: string; proxyPort: number; writable?: readonly string[]; bash?: string }
  /** The engine belongs in the person's container, which has no local launcher yet. */
  | { kind: "docker" | "server"; reason?: string };

export interface SandboxPlan {
  sandbox: EngineSandbox;
  /** The Space data directory; work folders live under `<dataDir>/work/<person>/<thread>`, scratch under `<dataDir>/scratch/<person>`. */
  dataDir: string;
  /** Hosts the engine may reach through the proxy (its provider's API). */
  egressHosts: readonly string[];
}

const SAFE = /[^a-zA-Z0-9_-]/g;
const part = (id: string): string => {
  const s = id.replace(SAFE, "_");
  if (s === "" || s === "." || s === "..") throw new SandboxError("sandbox.policy", "a person or thread id cannot name a folder");
  return s;
};

/** The folder one person's one thread works in. It is made if it is not there. Different people and different threads never share one. */
export function workFolder(dataDir: string, person: string, thread: string): string {
  const dir = path.join(dataDir, "work", part(person), part(thread));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function scratchFolder(dataDir: string, person: string): string {
  const dir = path.join(dataDir, "scratch", part(person));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

const sandboxId = (person: string): string => `vyre-sbx-${part(person).toLowerCase().replace(/_/g, "-")}`;

/**
 * `wrap` for createLocalLauncher. The work folder arrives as `start.cwd` (the opener's workFolder, made by workFolder() above) and names the person: `<dataDir>/work/<person>/<thread>`. A spawn
 * with any other folder is refused: the engine must never run in the daemon's own folder or anywhere else.
 */
export function sandboxWrap(plan: SandboxPlan, o: { homeFromScratch?: boolean } = {}): NonNullable<LocalLauncherOptions["wrap"]> {
  return (argv, start) => {
    const s = plan.sandbox;
    if (s.kind === "docker" || s.kind === "server") {
      throw new SandboxError("sandbox.unavailable", s.reason ?? "this engine has to run in the person's container, which cannot start a local engine yet");
    }
    if (start.cwd === undefined) throw new SandboxError("sandbox.policy", "a CLI engine needs a work folder");
    const workRoot = fs.realpathSync(path.join(plan.dataDir, "work"));
    const rel = path.relative(workRoot, start.cwd).split(path.sep);
    if (rel.length !== 2 || rel.some((x) => x === "" || x === "..")) throw new SandboxError("sandbox.policy", "the work folder is not one of the Space's person-and-thread folders");
    const person = rel[0] as string;
    const scratch = scratchFolder(plan.dataDir, person);
    // The roots are the real paths of the folders: a data folder reached through a symlink (/var is /private/var on a Mac) must name the same folders the work and scratch helpers returned.
    const roots: Roots = { work: [workRoot], scratch: [fs.realpathSync(path.join(plan.dataDir, "scratch"))] };
    const spec: SandboxSpec = {
      id: sandboxId(person), person, kind: s.kind === "wsl" ? "bwrap" : s.kind === "lowil" ? "seatbelt" : s.kind, scratch,
      mounts: [{ host: start.cwd, mode: "rw" }],
      egressHosts: plan.egressHosts,
      env: start.env,
    };
    if (s.kind === "wsl") return wslWrap(s, plan, spec, start, argv, scratch, workRoot);
    if (s.kind === "lowil") return lowWrap(s, plan, start, argv, person, scratch);
    if (s.kind === "bwrap") {
      // a turn on a sign-in kept in files sees them as its home: the scratch folder's own home is bound where the sandbox's home would be
      const home = o.homeFromScratch ? path.join(scratch, "home") : undefined;
      if (home) fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      const w = bwrapWallCommand(spec, roots, argv, { wallDir: s.wallDir, ...(s.node ? { node: s.node } : {}), ...(s.programRead ? { programRead: s.programRead } : {}), ...(home ? { home } : {}) });
      return [w.cmd, ...w.args];
    }
    const w = seatbeltCommand(spec, roots, argv, { proxyPort: s.proxyPort, ...(s.programRead ? { programRead: s.programRead } : {}) });
    // sandbox-exec keeps the caller's environment, so the proxy variables go in front with env(1). The CLI's own state (Claude Code's ~/.claude, Codex's ~/.codex), its temp files and its HOME live in the
    // scratch folder, the one place besides the work folder the profile lets it write: the person's real home stays closed, and the key travels in the environment, not in a file under it.
    const home = path.join(scratch, "home");
    const tmp = path.join(scratch, "tmp");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(tmp, { recursive: true });
    const own = { HOME: home, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache") };
    return ["/usr/bin/env", ...Object.entries({ ...proxyEnv(`http://127.0.0.1:${s.proxyPort}`), ...own }).map(([k, v]) => `${k}=${v}`), w.cmd, ...w.args];
  };
}

/** Windows variables that mean nothing in Linux; the engine in the VM gets the rest of its environment (the key, the MCP token, the CLI's own settings). */
const WINDOWS_ONLY = /^(path|pathext|systemroot|systemdrive|windir|temp|tmp|userprofile|appdata|localappdata|programdata|programfiles.*|programw6432|commonprogram.*|comspec|homedrive|homepath|username|userdomain.*|computername|os|processor_.*|number_of_processors|public|allusersprofile|driverdata|logonserver|sessionname|psmodulepath|onedrive.*|wslenv|wsl_utf8)$/i;
const WIN_PATH = /^[A-Za-z]:[\\/]/;

/**
 * The argv that runs a CLI engine on Windows: wsl.exe starts bwrap in Vyre's distribution with the same walled profile a Linux server uses (bwrapWallCommand), every folder and argument that is a
 * Windows path given as the VM sees it. The engine is the Linux build Vyre installed (engine-install.ts, linux-*-musl), so argv[0] is already a path in the engines folder.
 */
function wslWrap(s: Extract<EngineSandbox, { kind: "wsl" }>, plan: SandboxPlan, spec: SandboxSpec, start: { env: Record<string, string>; cwd?: string }, argv: readonly string[], scratch: string, workRoot: string): string[] {
  const v = s.vmPath ?? toWslPath;
  const home = path.join(scratch, "home");
  fs.mkdirSync(home, { recursive: true });
  const roots: Roots = { work: [v(workRoot)], scratch: [v(fs.realpathSync(path.join(plan.dataDir, "scratch")))] };
  const env = Object.fromEntries(Object.entries(start.env).filter(([k]) => !WINDOWS_ONLY.test(k)));
  // Claude Code's musl build uses the system's ripgrep (Alpine): its own is a glibc program
  env["USE_BUILTIN_RIPGREP"] = "0";
  // the shell an engine's command tool starts (Alpine's bash, installed with the distribution)
  env["SHELL"] = "/bin/bash";
  const vmSpec: SandboxSpec = { ...spec, kind: "bwrap", scratch: v(scratch), mounts: [{ host: v(start.cwd as string), mode: "rw" }], env };
  const vmArgv = argv.map((a) => (WIN_PATH.test(a) ? v(a) : a));
  // the policy of this turn: the agent's proxy reads it from the next connection on
  s.agent.setPolicy(s.wall);
  const w = bwrapWallCommand(vmSpec, roots, vmArgv, {
    wallDir: s.agent.wallDir, node: s.agent.node, splitUsr: s.agent.splitUsr, home: v(home),
    ...(s.programRead ? { programRead: s.programRead.map((p) => (WIN_PATH.test(p) ? v(p) : p)) } : {}),
  });
  return [wslExe(), "-d", s.distro, "-u", s.user, "--cd", "/", "--exec", "/usr/bin/bwrap", ...w.args];
}

/**
 * The argv of a CLI engine in a Windows Personal Space: vyre-lowrun starts it at Low integrity in a Job Object. The folders it may change are labelled Low first (once each): this person's work
 * folders, their scratch folder (the engine's home, config and temp) and the folders they added. Its home, config and temp point into the scratch folder, so the CLI's own state is somewhere it
 * may write; its proxy variables name the egress proxy.
 */
function lowWrap(s: Extract<EngineSandbox, { kind: "lowil" }>, plan: SandboxPlan, start: { env: Record<string, string>; cwd?: string }, argv: readonly string[], person: string, scratch: string): string[] {
  const home = path.join(scratch, "home");
  const tmp = path.join(scratch, "tmp");
  for (const dir of [path.join(plan.dataDir, "work", person), scratch, ...(s.writable ?? [])]) labelLow(dir);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const own = {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), TEMP: tmp, TMP: tmp,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CLAUDE_CODE_TMPDIR: tmp, CODEX_HOME: path.join(home, ".codex"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
  };
  for (const d of [own.APPDATA, own.LOCALAPPDATA]) fs.mkdirSync(d, { recursive: true });
  // the engine's own copy of Git Bash (sandbox/src/win/msys.ts): a person's Git Bash window must not stop the engine's Bash tool
  if (s.bash) (own as Record<string, string>)["CLAUDE_CODE_GIT_BASH_PATH"] = s.bash;
  void start;
  return lowrunArgv(s.helper, argv, { ...proxyEnv(`http://127.0.0.1:${s.proxyPort}`), ...own });
}
