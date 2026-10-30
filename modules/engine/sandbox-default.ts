// The sandbox a daemon uses for CLI engines when the host gave no plan of its own (P-L2_23): without one, agents on a CLI account could not start at all. Linux with bubblewrap gets bwrap and
// the network wall (an egress proxy behind a unix socket); a Mac gets Seatbelt with an egress proxy on loopback. Where the platform truly cannot sandbox, the plan says so and every CLI turn
// refuses with sandbox.unavailable; it never falls back to running the engine unwrapped. The wall lives as long as the daemon: close() stops it.
import fs from "node:fs";
import path from "node:path";
import { createEgressProxy, startNetWall } from "../../sandbox/src/index.ts";
import type { EngineSandbox, SandboxPlan } from "./sandbox.ts";

/** What a CLI engine may reach through the proxy: its vendor's API and sign-in hosts, and nothing else. */
export const ENGINE_EGRESS_HOSTS: readonly string[] = [
  "api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai", "api.openai.com", "*.openai.com", "chatgpt.com", "*.chatgpt.com", "api.x.ai", "*.x.ai",
];

export interface DefaultSandbox { plan: SandboxPlan; close(): Promise<void> }

export interface DefaultSandboxOptions {
  dataDir: string;
  platform?: NodeJS.Platform;
  /** Where to look for bwrap. Default: the usual places. */
  bwrapPaths?: readonly string[];
  egressHosts?: readonly string[];
  node?: string;
  /** Extra read-only folders for the program being run (a CLI installed outside /usr). */
  programRead?: readonly string[];
}

const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];

/** The CLI engines a person may have installed. */
const CLI_NAMES = ["claude", "codex", "grok"] as const;

/**
 * PATH for finding a CLI engine. An app opened from the Finder or the Dock gets PATH=/usr/bin:/bin:/usr/sbin:/sbin, where `claude` and `codex` are never installed; a person's shell would add the
 * folders below. They are appended (the given PATH keeps priority) and only the ones that exist are added, newest nvm version first. Other platforms keep their PATH as it is.
 */
export function enginePath(env: { PATH?: string | undefined }, home: string, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = fs.existsSync, list: (p: string) => string[] = (p) => fs.readdirSync(p)): string {
  const have = (env.PATH ?? "/usr/bin:/bin").split(path.delimiter).filter((p) => p !== "");
  if (platform !== "darwin") return have.join(path.delimiter);
  const nvm = path.join(home, ".nvm", "versions", "node");
  let versions: string[] = [];
  try { versions = exists(nvm) ? list(nvm).filter((v) => /^v\d+/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => path.join(nvm, v, "bin")) : []; } catch { /* no nvm */ }
  const more = [path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".claude", "local"), path.join(home, ".bun", "bin"), path.join(home, ".volta", "bin"), ...versions];
  return [...have, ...more.filter((p) => !have.includes(p) && exists(p))].join(path.delimiter);
}

/**
 * Where the installed CLI engines live, so Seatbelt can let them read their own program. A CLI installed with npm under nvm (`~/.nvm/versions/node/v24/bin/claude`), bun, volta or Claude Code's
 * own installer (`~/.claude/local/claude`) sits outside the folders the profile always opens. For each CLI found on PATH the folder that holds the link and the install prefix above it are returned
 * (the link's own and the real file's), so a prefix that holds the CLI, its node_modules and its node can be read. Never the home folder, a parent of it, or the folders that hold a person's sign-ins
 * and history (`~/.claude`, `~/.codex`, `~/.grok`): only a folder inside them.
 */
export function cliInstallRoots(env: { PATH?: string | undefined }, home: string, exists: (p: string) => boolean = fs.existsSync, real: (p: string) => string = fs.realpathSync): string[] {
  const closed = new Set([".claude", ".codex", ".grok"].map((d) => path.join(home, d)));
  const tooWide = (p: string): boolean => p === "/" || p === home || home.startsWith(`${p}${path.sep}`) || closed.has(p) || ["/usr", "/bin", "/sbin", "/System", "/Library", "/private", "/Users", "/Applications"].includes(p);
  const out = new Set<string>();
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    for (const name of CLI_NAMES) {
      const found = path.join(dir, name);
      if (!exists(found)) continue;
      let target = found;
      try { target = real(found); } catch { /* a link that leads nowhere has nothing to read */ continue; }
      for (const p of [path.dirname(found), path.dirname(path.dirname(found)), path.dirname(target), path.dirname(path.dirname(target))]) if (!tooWide(p)) out.add(p);
    }
  }
  return [...out];
}

export async function defaultSandbox(o: DefaultSandboxOptions): Promise<DefaultSandbox> {
  const platform = o.platform ?? process.platform;
  const hosts = o.egressHosts ?? ENGINE_EGRESS_HOSTS;
  const node = o.node ?? process.execPath;
  const unavailable = (reason: string): DefaultSandbox => ({ plan: { sandbox: { kind: "server", reason }, dataDir: o.dataDir, egressHosts: hosts }, close: async () => undefined });
  const done = (sandbox: EngineSandbox, close: () => Promise<void>): DefaultSandbox => ({ plan: { sandbox, dataDir: o.dataDir, egressHosts: hosts }, close });
  if (platform === "linux") {
    if (!(o.bwrapPaths ?? BWRAP).some((p) => fs.existsSync(p))) return unavailable("bubblewrap (bwrap) is not installed on this server, so CLI engines cannot be sandboxed");
    const wall = await startNetWall({ allow: hosts });
    return done({ kind: "bwrap", wallDir: wall.dir, node, ...(o.programRead ? { programRead: o.programRead } : {}) }, () => wall.close());
  }
  if (platform === "darwin") {
    const proxy = createEgressProxy({ allow: hosts });
    const { port } = await proxy.listen();
    // Seatbelt denies reads by default: the program being run (this Node, and the CLI's install folders) must be readable.
    const home = process.env["HOME"] ?? "/";
    const programRead = [...(o.programRead ?? []), path.dirname(path.dirname(node)), path.join(home, ".local"), "/opt/homebrew", "/usr/local", ...cliInstallRoots({ PATH: enginePath(process.env, home) }, home)].filter((p) => p !== "/");
    return done({ kind: "seatbelt", proxyPort: port, programRead }, () => proxy.close());
  }
  return unavailable(`CLI engines cannot be sandboxed on ${platform}`);
}
