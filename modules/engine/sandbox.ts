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
import { sha256Hex } from "../../kernel/src/log/hash.ts";
import { CONNECT_SOURCE, SandboxError, bwrapWallCommand, seatbeltCommand, sshFiles, toolProxyEnv } from "../../sandbox/src/index.ts";
import type { EgressEvent, EgressRule, EngineAccess, Roots, SandboxSpec } from "../../sandbox/src/index.ts";
import type { LocalLauncherOptions } from "../../agent/src/drivers/cli/launcher.ts";

/** What the host knows about the sandbox it runs a CLI engine in. The wall (egress proxy) is started by the host and outlives the turns. */
export type EngineSandbox =
  | { kind: "bwrap"; wallDir: string; programRead?: readonly string[]; node?: string }
  | { kind: "seatbelt"; proxyPort: number; programRead?: readonly string[] }
  /** The engine belongs in the person's container, which has no local launcher yet. */
  | { kind: "docker" | "server"; reason?: string };

export interface SandboxPlan {
  sandbox: EngineSandbox;
  /** The Space data directory; work folders live under `<dataDir>/work/<person>/<thread>`, scratch under `<dataDir>/scratch/<person>`. */
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

/**
 * Where work and scratch folders live. A Mac and Linux: `<dataDir>/work/<person>/<thread>` and `<dataDir>/scratch/<person>`, named by the ids. Windows keeps its paths short, since the engines and
 * the tools they run are not all sure to read a path past MAX_PATH (260), and Vyre does not count on long-path support in programs it does not own: `<dataDir>\w\<p>\<t>` and `<dataDir>\s\<p>`, each segment the first
 * 10 hex digits of a hash of the id, and an index Vyre keeps beside them (`<dataDir>\w-ids\<segment>`, the id) turns a segment back into its id. The engine cannot change the index: it is not in
 * a folder the engine may write.
 */
export function layoutRoots(platform: NodeJS.Platform = process.platform): { work: string; scratch: string } {
  return platform === "win32" ? { work: "w", scratch: "s" } : { work: "work", scratch: "scratch" };
}

const IDS = "w-ids";

/** A person's or a thread's folder name. Windows: a short hash, kept in the index; a hash another id already holds is made longer. */
export function segmentOf(dataDir: string, kind: "person" | "thread", id: string, platform: NodeJS.Platform = process.platform): string {
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
export function idOfSegment(dataDir: string, kind: "person" | "thread", seg: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return seg;
  if (!/^[0-9a-f]{10,64}$/.test(seg)) return null;
  try {
    const v = fs.readFileSync(path.join(dataDir, IDS, seg), "utf8");
    return v.startsWith(`${kind}:`) ? v.slice(kind.length + 1) : null;
  } catch { return null; }
}

/** The person and the thread of a work folder, with the work root and the person's segment, or null for any other folder. The one parser of the layout. */
export function workParts(dataDir: string, cwd: string | undefined, platform: NodeJS.Platform = process.platform): { person: string; threadId: string; workRoot: string; personSeg: string } | null {
  if (cwd === undefined) return null;
  let workRoot: string;
  try { workRoot = fs.realpathSync(path.join(dataDir, layoutRoots(platform).work)); } catch { return null; }
  const rel = path.relative(workRoot, cwd).split(path.sep);
  if (rel.length !== 2 || rel.some((x) => x === "" || x === "..")) return null;
  const person = idOfSegment(dataDir, "person", rel[0] as string, platform);
  const threadId = idOfSegment(dataDir, "thread", rel[1] as string, platform);
  return person !== null && threadId !== null ? { person, threadId, workRoot, personSeg: rel[0] as string } : null;
}

/** The folder one person's one thread works in. It is made if it is not there. Different people and different threads never share one. */
export function workFolder(dataDir: string, person: string, thread: string, platform: NodeJS.Platform = process.platform): string {
  const dir = path.join(dataDir, layoutRoots(platform).work, segmentOf(dataDir, "person", person, platform), segmentOf(dataDir, "thread", thread, platform));
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
 * `wrap` for createLocalLauncher. The work folder arrives as `start.cwd` (the opener's workFolder, made by workFolder() above) and names the person: `<dataDir>/work/<person>/<thread>`. A spawn
 * with any other folder is refused: the engine must never run in the daemon's own folder or anywhere else.
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
    const scratch = scratchFolder(plan.dataDir, person);
    // The roots are the real paths of the folders: a data folder reached through a symlink (/var is /private/var on a Mac) must name the same folders the work and scratch helpers returned.
    const roots: Roots = { work: [workRoot], scratch: [fs.realpathSync(path.join(plan.dataDir, layoutRoots().scratch))] };
    const spec: SandboxSpec = {
      id: sandboxId(person), person, kind: s.kind, scratch,
      mounts: [{ host: start.cwd, mode: "rw" }],
      egressHosts: plan.egressHosts,
      env: start.env,
    };
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
