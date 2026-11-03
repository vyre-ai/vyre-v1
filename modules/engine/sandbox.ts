// The sandbox around a CLI engine (P-L2_23, security review S8 finding 1). A CLI engine (Claude Code, Codex, Grok) is a program the daemon starts; without a wrap it can read every file the
// daemon's user can read. This builds the `wrap` the local launcher takes, so the engine runs in the person's sandbox: Seatbelt on a Mac, bubblewrap with the network wall on Linux. It lives here
// because agent code may not import the sandbox package.
//   - The working folder is one folder per person, thread and agent under the Space data directory. It is the first read-write mount (bwrap does --chdir to the first mount) and the process's cwd.
//     Two agents working for one person in one chat never share it, so neither reads the other's memory guide; the chat's `shared` folder beside them is the one place both see.
//   - bwrap starts with --clearenv, so the spawn's environment (the key, VYRE_MCP_TOKEN) is copied into the sandbox spec and travels as --setenv. Seatbelt inherits the environment, so the proxy
//     variables are put in front of the command with env(1).
//   - Where the engine has to run in the person's container (host placement, Windows without WSL) there is no local wrap: the spawn fails with sandbox.unavailable and never falls back to the
//     unwrapped launcher.
import fs from "node:fs";
import path from "node:path";
import { randomHex, sha256Hex } from "../../kernel/src/log/hash.ts";
import { CONNECT_SOURCE, SandboxError, bwrapWallCommand, proxyEnv, seatbeltCommand, sshConfig, sshFiles, toolProxyEnv } from "../../sandbox/src/index.ts";
import type { EgressEvent, EgressRule, EngineAccess, Roots, SandboxSpec } from "../../sandbox/src/index.ts";
import { toWslPath, wslExe } from "../../sandbox/src/wsl/wsl.ts";
import type { AgentOptions, WslAgent } from "../../sandbox/src/wsl/wsl.ts";
import type { LocalLauncherOptions } from "../../agent/src/drivers/cli/launcher.ts";
import { labelKeyStores, labelLow, lowrunArgv, pipeName } from "../../sandbox/src/win/lowrun.ts";
import type { KeyStores } from "../../sandbox/src/win/lowrun.ts";

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
  | { kind: "lowil"; helper: string; proxyPort: number; writable?: readonly string[]; bash?: string; ssh?: string; keyStores?: KeyStores }
  /** The engine belongs in the person's container, which has no local launcher yet. */
  | { kind: "docker" | "server"; reason?: string };

export interface SandboxPlan {
  sandbox: EngineSandbox;
  /** The Space data directory; work folders live under `<dataDir>/work/<person>/<thread>/<agent>` (beside the chat's `shared` folder), scratch under `<dataDir>/scratch/<person>`. */
  dataDir: string;
  /** Hosts the engine may reach through the proxy (its provider's API), when the wall runs a list. */
  egressHosts: readonly string[];
  /** The rule of the plan's own wall (egress-policy.ts). Absent: the list above. */
  egressRule?: EgressRule;
  /**
   * Open a wall for one engine process, with the rule its turn carries and a watcher for where it went (sandbox-default.ts). Absent (a host's own plan, a test's): the process uses the plan's wall.
   * The wall is stopped when the process ends.
   */
  openWall?: (egress: { allow: string[]; rule: EgressRule }, onEvent?: (e: EgressEvent) => void) => Promise<{ sandbox: EngineSandbox; close(): Promise<void> }>;
}

const SAFE = /[^a-zA-Z0-9_-]/g;
const part = (id: string): string => {
  const s = id.replace(SAFE, "_");
  if (s === "" || s === "." || s === "..") throw new SandboxError("sandbox.policy", "a person or thread id cannot name a folder");
  return s;
};

/** The name of the folder of a chat that every agent working there for the same person may read and write. No agent's own folder is ever named this. */
export const SHARED_FOLDER = "shared";

/**
 * Where work and scratch folders live. A Mac and Linux: `<dataDir>/work/<person>/<thread>/<agent>` and `<dataDir>/scratch/<person>`, named by the ids. Windows keeps its paths short, since the engines
 * and the tools they run are not all sure to read a path past MAX_PATH (260), and Vyre does not count on long-path support in programs it does not own: `<dataDir>\w\<p>\<t>\<a>` and `<dataDir>\s\<p>`,
 * each segment the first 10 hex digits of a hash of the id, and an index Vyre keeps beside them (`<dataDir>\w-ids\<segment>`, the id) turns a segment back into its id. The engine cannot change the
 * index: it is not in a folder the engine may write. The chat's shared folder is `shared` on every platform.
 */
export function layoutRoots(platform: NodeJS.Platform = process.platform): { work: string; scratch: string } {
  return platform === "win32" ? { work: "w", scratch: "s" } : { work: "work", scratch: "scratch" };
}

const IDS = "w-ids";
type SegKind = "person" | "thread" | "agent";

/** A person's, a thread's or an agent's folder name. Windows: a short hash, kept in the index; a hash another id already holds is made longer. */
export function segmentOf(dataDir: string, kind: SegKind, id: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return part(id);
  part(id);   // the same ids are refused as on a Mac
  const full = sha256Hex(`${kind}:${id}`);
  const index = path.join(dataDir, IDS);
  fs.mkdirSync(index, { recursive: true });
  for (let n = 10; n <= full.length; n += 2) {
    const seg = full.slice(0, n);
    const file = path.join(index, seg);
    let have: string | null = null;
    try { have = fs.readFileSync(file, "utf8"); } catch { /* not yet */ }
    if (have === `${kind}:${id}`) return seg;
    if (have === null) { fs.writeFileSync(file, `${kind}:${id}`); return seg; }
  }
  throw new SandboxError("sandbox.policy", "a person or thread id cannot name a folder");
}

/** The id a folder name stands for, or null when it is not one Vyre made. */
export function idOfSegment(dataDir: string, kind: SegKind, seg: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return seg;
  if (!/^[0-9a-f]{10,64}$/.test(seg)) return null;
  try {
    const v = fs.readFileSync(path.join(dataDir, IDS, seg), "utf8");
    return v.startsWith(`${kind}:`) ? v.slice(kind.length + 1) : null;
  } catch { return null; }
}

/**
 * The person, the thread and (in an agent's own folder) the agent of a work folder, with the work root and the person's segment, or null for any other folder, the chat's shared folder included:
 * an engine never runs there. `<person>/<thread>/<agent>` is the layout since rc.17; `<person>/<thread>` is a folder of the person's own (plugins). The one parser of the layout.
 */
export function workParts(dataDir: string, cwd: string | undefined, platform: NodeJS.Platform = process.platform): { person: string; threadId: string; agent?: string; workRoot: string; personSeg: string } | null {
  if (cwd === undefined) return null;
  let workRoot: string;
  try { workRoot = fs.realpathSync(path.join(dataDir, layoutRoots(platform).work)); } catch { return null; }
  const rel = path.relative(workRoot, cwd).split(path.sep);
  if ((rel.length !== 2 && rel.length !== 3) || rel.some((x) => x === "" || x === "..") || rel[2] === SHARED_FOLDER) return null;
  const person = idOfSegment(dataDir, "person", rel[0] as string, platform);
  const threadId = idOfSegment(dataDir, "thread", rel[1] as string, platform);
  const agent = rel.length === 3 ? idOfSegment(dataDir, "agent", rel[2] as string, platform) : undefined;
  if (person === null || threadId === null || agent === null) return null;
  return { person, threadId, ...(agent !== undefined ? { agent } : {}), workRoot, personSeg: rel[0] as string };
}

/**
 * The folder one agent works in for one person in one thread. It is made if it is not there. Different people, threads and agents never share one: two agents in one chat each get their own,
 * with the chat's shared folder beside them. Without an agent it is the person's folder for the thread (plugins keep theirs there).
 */
export function workFolder(dataDir: string, person: string, thread: string, agent?: string, platform: NodeJS.Platform = process.platform): string {
  if (agent !== undefined && part(agent) === SHARED_FOLDER) throw new SandboxError("sandbox.policy", "an agent id cannot name the shared folder");
  const base = path.join(dataDir, layoutRoots(platform).work, segmentOf(dataDir, "person", person, platform), segmentOf(dataDir, "thread", thread, platform));
  const dir = agent === undefined ? base : path.join(base, segmentOf(dataDir, "agent", agent, platform));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

/** The folder of one person's thread that all the agents working there for that person share: the chat's shared files, and nothing of any one agent's own. */
export function sharedFolder(dataDir: string, person: string, thread: string, platform: NodeJS.Platform = process.platform): string {
  const dir = path.join(dataDir, layoutRoots(platform).work, segmentOf(dataDir, "person", person, platform), segmentOf(dataDir, "thread", thread, platform), SHARED_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function scratchFolder(dataDir: string, person: string, platform: NodeJS.Platform = process.platform): string {
  const dir = path.join(dataDir, layoutRoots(platform).scratch, segmentOf(dataDir, "person", person, platform));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

const sandboxId = (person: string): string => `vyre-sbx-${part(person).toLowerCase().replace(/_/g, "-")}`;

/**
 * `wrap` for createLocalLauncher. The work folder arrives as `start.cwd` (the opener's workFolder, made by workFolder() above) and names the person: `<dataDir>/work/<person>/<thread>/<agent>`,
 * or `<dataDir>/work/<person>/<thread>` for a folder of the person's own. A spawn with any other folder is refused: the engine must never run in the daemon's own folder or anywhere else. An agent's
 * folder is mounted with the chat's shared folder and nothing else of the chat: another agent's folder beside it stays closed.
 */
export function sandboxWrap(plan: SandboxPlan, o: { homeFromScratch?: boolean; access?: EngineAccess; basePath?: string } = {}): NonNullable<LocalLauncherOptions["wrap"]> {
  return (argv, start) => {
    const s = plan.sandbox;
    if (s.kind === "docker" || s.kind === "server") {
      throw new SandboxError("sandbox.unavailable", s.reason ?? "this engine has to run in the person's container, which cannot start a local engine yet");
    }
    if (start.cwd === undefined) throw new SandboxError("sandbox.policy", "a CLI engine needs a work folder");
    const where = workParts(plan.dataDir, start.cwd);
    if (where === null) throw new SandboxError("sandbox.policy", "the work folder is not one of the Space's person-and-thread folders");
    const { person, workRoot } = where;
    const shared = where.agent !== undefined ? sharedFolder(plan.dataDir, person, where.threadId) : null;
    const scratch = scratchFolder(plan.dataDir, person);
    // The roots are the real paths of the folders: a data folder reached through a symlink (/var is /private/var on a Mac) must name the same folders the work and scratch helpers returned.
    const roots: Roots = { work: [workRoot], scratch: [fs.realpathSync(path.join(plan.dataDir, layoutRoots().scratch))] };
    const spec: SandboxSpec = {
      id: sandboxId(person), person, kind: s.kind === "wsl" ? "bwrap" : s.kind === "lowil" ? "seatbelt" : s.kind, scratch,
      mounts: [{ host: start.cwd, mode: "rw" }, ...(shared ? [{ host: shared, mode: "rw" as const }] : [])],
      egressHosts: plan.egressHosts,
      env: start.env,
    };
    if (s.kind === "wsl") return wslWrap(s, plan, spec, start, argv, scratch, workRoot);
    if (s.kind === "lowil") return lowWrap(s, plan, start, argv, where.personSeg, scratch, o);
    if (s.kind === "bwrap") {
      // a turn on a sign-in kept in files sees them as its home: the scratch folder's own home is bound where the sandbox's home would be
      const home = o.homeFromScratch ? path.join(scratch, "home") : undefined;
      if (home) fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      const w = bwrapWallCommand(spec, roots, argv, { wallDir: s.wallDir, ...(s.node ? { node: s.node } : {}), ...(s.programRead ? { programRead: s.programRead } : {}), ...(home ? { home } : {}), ...(o.access ? { access: o.access } : {}), ...(o.basePath ? { basePath: o.basePath } : {}) });
      return [w.cmd, ...w.args];
    }
    const w = seatbeltCommand(spec, roots, argv, { proxyPort: s.proxyPort, ...(s.programRead ? { programRead: s.programRead } : {}), ...(o.access ? { access: o.access } : {}) });
    // sandbox-exec keeps the caller's environment, so the proxy variables go in front with env(1). The CLI's own state (Claude Code's ~/.claude, Codex's ~/.codex), its temp files and its HOME live in the
    // scratch folder, the one place besides the work folder the profile lets it write: the person's real home stays closed, and the key travels in the environment, not in a file under it.
    const home = path.join(scratch, "home");
    const tmp = path.join(scratch, "tmp");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(tmp, { recursive: true });
    // the CONNECT helper ssh runs as its ProxyCommand (git+ssh to a public host), in the scratch folder the profile lets the engine read
    const helper = path.join(scratch, "net", "connect.mjs");
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, CONNECT_SOURCE, { mode: 0o644 });
    const own = { HOME: home, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache") };
    const net = toolProxyEnv(`http://127.0.0.1:${s.proxyPort}`, { node: process.execPath, helper, port: s.proxyPort, ...sshFiles(o.access, path.join(home, ".vyre-known-hosts")) });
    // what the engine may touch (engine-access.ts): the package managers pointed at the person's own install locations, the SSH agent, and their bin folders first on PATH
    const acc = o.access ? { ...o.access.env, ...(o.access.sshAuthSock ? { SSH_AUTH_SOCK: o.access.sshAuthSock } : {}), ...(o.basePath ? { PATH: [...o.access.pathAdd, o.basePath].join(":") } : {}) } : {};
    return ["/usr/bin/env", ...Object.entries({ ...net, ...own, ...acc }).map(([k, v]) => `${k}=${v}`), w.cmd, ...w.args];
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
  const roots: Roots = { work: [v(workRoot)], scratch: [v(fs.realpathSync(path.join(plan.dataDir, layoutRoots().scratch)))] };
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
function lowWrap(s: Extract<EngineSandbox, { kind: "lowil" }>, plan: SandboxPlan, start: { env: Record<string, string>; cwd?: string }, argv: readonly string[], personSeg: string, scratch: string, o: { access?: EngineAccess; basePath?: string } = {}): string[] {
  const home = path.join(scratch, "home");
  const tmp = path.join(scratch, "tmp");
  // the folders the person added (engine-access.ts, checked: never a drive's root, a system folder or Vyre's data) are labelled with the rest
  const fresh: string[] = [];
  for (const dir of [path.join(plan.dataDir, layoutRoots().work, personSeg), scratch, ...(s.writable ?? []), ...(o.access?.added ?? [])]) if (labelLow(dir)) fresh.push(dir);
  // icacls labels everything under an added folder Low, a key store in it too (the person added their whole home): those are made private again before the engine starts
  if (fresh.length > 0 && s.keyStores) labelKeyStores(s.helper, s.keyStores, fresh);
  const own = {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), TEMP: tmp, TMP: tmp,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CLAUDE_CODE_TMPDIR: tmp, CODEX_HOME: path.join(home, ".codex"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
  };
  // every folder the variables name is there before the engine starts: codex.exe refuses a CODEX_HOME that does not exist
  for (const d of [home, tmp, own.APPDATA, own.LOCALAPPDATA, own.CLAUDE_CONFIG_DIR, own.CODEX_HOME]) fs.mkdirSync(d, { recursive: true });
  // the engine's own copy of Git Bash (sandbox/src/win/msys.ts): a person's Git Bash window must not stop the engine's Bash tool
  if (s.bash) (own as Record<string, string>)["CLAUDE_CODE_GIT_BASH_PATH"] = s.bash;
  void start;
  const net = toolProxyEnv(`http://127.0.0.1:${s.proxyPort}`);
  // git over SSH with no shell: GIT_SSH is Vyre's ssh helper, which runs Windows OpenSSH with the config written here (the turn's proxy through the CONNECT helper, the known-hosts files, the agent
  // relay). The relay is this job's own pipe, labelled so a Low process may use it, passing on to the person's agent (Windows OpenSSH's service), whose pipe a Low process cannot open.
  const target = pipeName(o.access?.sshAuthSock);
  const relay = target !== null ? `vyre-agent-${process.pid}-${randomHex(6)}` : null;
  let ssh: Record<string, string> = {};
  if (s.ssh) {
    const helper = path.join(scratch, "net", "connect.mjs");
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, CONNECT_SOURCE);
    const config = path.join(home, ".ssh", "vyre_config");
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, sshConfig({ node: process.execPath, helper, port: s.proxyPort, platform: "win32", ...sshFiles(o.access, path.join(home, ".vyre-known-hosts")), ...(relay ? { agent: `\\\\.\\pipe\\${relay}` } : {}) }));
    ssh = { GIT_SSH: s.ssh, GIT_SSH_VARIANT: "ssh", VYRE_SSH_CONFIG: config };
  }
  const acc = o.access && o.basePath ? { PATH: [...o.access.pathAdd, o.basePath].join(";") } : {};
  return lowrunArgv(s.helper, argv, { ...net, ...own, ...ssh, ...acc }, relay && target ? { agentRelay: { pipe: relay, target } } : {});
}
