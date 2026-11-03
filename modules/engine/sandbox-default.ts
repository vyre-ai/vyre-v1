// The sandbox a daemon uses for CLI engines when the host gave no plan of its own (P-L2_23): without one, agents on a CLI account could not start at all. Linux with bubblewrap gets bwrap and
// the network wall (an egress proxy behind a unix socket); a Mac gets Seatbelt with an egress proxy on loopback. Where the platform truly cannot sandbox, the plan says so and every CLI turn
// refuses with sandbox.unavailable; it never falls back to running the engine unwrapped. The wall lives as long as the daemon: close() stops it.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PUBLIC_RULE, createEgressProxy, startNetWall, validHostPattern } from "../../sandbox/src/index.ts";
import type { EgressEvent, EgressRule } from "../../sandbox/src/index.ts";
import type { EngineSandbox, SandboxPlan } from "./sandbox.ts";

/** The AI providers' API and sign-in hosts: what a CLI engine needs to work at all, and all it may reach under "Only the AI providers". */
export const ENGINE_EGRESS_HOSTS: readonly string[] = [
  "api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai", "api.openai.com", "*.openai.com", "chatgpt.com", "*.chatgpt.com", "api.x.ai", "*.x.ai",
];

/**
 * What AI tools can reach on the internet, as a Space owner or admin chooses it in the Console (Space, AI, Internet access; the setting engine.egress):
 *   public     anything public (the default, owner ruling 3 Nov)
 *   providers  only the AI providers (ENGINE_EGRESS_HOSTS), the old behaviour
 *   list       the AI providers and the hosts listed
 */
export interface EgressPolicy { mode: "public" | "providers" | "list"; hosts: readonly string[] }
export const DEFAULT_EGRESS_POLICY: EgressPolicy = Object.freeze({ mode: "public", hosts: Object.freeze([]) as readonly string[] });

/** The wall's egress options: the allow-list and the rule. Plain JSON, so the Windows (WSL2) sandbox sends it into its VM as it is, to the same startNetWall. */
export interface WallEgress { allow: string[]; rule: EgressRule }

/** A setting value read back from the store, or anything: what it says, with every host it lists that is not a host name dropped. Unreadable is the default. */
export function egressPolicyOf(v: unknown): EgressPolicy {
  const o = (v !== null && typeof v === "object" ? v : {}) as { mode?: unknown; hosts?: unknown };
  const mode = o.mode === "providers" || o.mode === "list" || o.mode === "public" ? o.mode : DEFAULT_EGRESS_POLICY.mode;
  const hosts = Array.isArray(o.hosts) ? [...new Set(o.hosts.filter((h): h is string => typeof h === "string" && validHostPattern(h)))].slice(0, 500) : [];
  return { mode, hosts };
}

/**
 * The one place that builds the wall's egress options (lane l-winengine builds its VM's wall from the same call). The AI providers are always on a list: a Space that lists only its own hosts still
 * has engines that can answer.
 */
export function wallEgress(policy: EgressPolicy = DEFAULT_EGRESS_POLICY): WallEgress {
  const providers = [...ENGINE_EGRESS_HOSTS];
  if (policy.mode === "public") return { allow: providers, rule: PUBLIC_RULE };
  const allow = policy.mode === "list" ? [...new Set([...providers, ...egressPolicyOf(policy).hosts])] : providers;
  return { allow, rule: { egress: "list", allow } };
}

/** The wall's options for a rule a spawn carries (egress-policy.ts RULE_ENV). */
export function wallEgressOfRule(rule: EgressRule): WallEgress {
  return rule.egress === "public" ? { allow: [...ENGINE_EGRESS_HOSTS], rule } : { allow: [...rule.allow], rule };
}

export interface DefaultSandbox { plan: SandboxPlan; close(): Promise<void> }

/** A wall of its own for one engine process: the sandbox to run it in, and how to stop the wall when the process has ended. */
export interface OpenedWall { sandbox: EngineSandbox; close(): Promise<void> }

export interface DefaultSandboxOptions {
  dataDir: string;
  platform?: NodeJS.Platform;
  /** Where to look for bwrap. Default: the usual places. */
  bwrapPaths?: readonly string[];
  egressHosts?: readonly string[];
  /** The shared wall's egress (plugins, and turns that carry no rule). Default: wallEgress(), anything public. egressHosts, when given, makes it that list. */
  egress?: WallEgress;
  node?: string;
  /** Extra read-only folders for the program being run (a CLI installed outside /usr). */
  programRead?: readonly string[];
}

const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];

/** The CLI engines a person may have installed. */
const CLI_NAMES = ["claude", "codex", "grok"] as const;

/**
 * PATH for finding a CLI engine. An app opened from the Finder or the Dock gets PATH=/usr/bin:/bin:/usr/sbin:/sbin, where `claude` and `codex` are never installed; a person's shell would add the
 * folders below. They are appended (the given PATH keeps priority) and only the ones that exist are added, newest nvm version first. Other platforms keep their PATH as it is. `owned` are the folders of
 * Vyre's own engines (engine-install.ts ownedProgramDirs), last on every platform: a person's own install wins, then a copy an app carries, then Vyre's.
 */
export function enginePath(env: { PATH?: string | undefined }, home: string, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = fs.existsSync, list: (p: string) => string[] = (p) => fs.readdirSync(p), owned: readonly string[] = []): string {
  const have = (env.PATH ?? "/usr/bin:/bin").split(path.delimiter).filter((p) => p !== "");
  const last = (more: readonly string[]): string => [...have, ...more.filter((p, i) => !have.includes(p) && more.indexOf(p) === i && exists(p))].join(path.delimiter);
  if (platform !== "darwin") return last(owned);
  const nvm = path.join(home, ".nvm", "versions", "node");
  let versions: string[] = [];
  try { versions = exists(nvm) ? list(nvm).filter((v) => /^v\d+/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => path.join(nvm, v, "bin")) : []; } catch { /* no nvm */ }
  return last([path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".claude", "local"), path.join(home, ".bun", "bin"), path.join(home, ".volta", "bin"), ...versions, ...owned]);
}

// The CLIs a desktop app carries inside itself (the codex in ChatGPT.app, Claude Code under the Claude app) are not looked in: they are builds tied to their app, and the ChatGPT
// app's codex refused every turn outside it ("workspace routing discovery failed"). Vyre installs its own pinned copy instead (engine-install.ts), last on the PATH above.

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

/**
 * What Apple's `git` needs to run under Seatbelt. /usr/bin/git is a shim that asks xcrun where the real git is, and xcrun loads a library from the developer folder: with that folder closed, git answers
 * "unable to load libxcrun (file system sandbox blocked open())" and every `git add` a crew teammate runs fails. The folder holds Apple's public tools, so it is opened for reading only.
 */
export function appleDeveloperRoots(exists: (p: string) => boolean = fs.existsSync, selected: string | null = selectedDeveloperDir()): string[] {
  // the developer folder `xcode-select` points at is the one the shim runs (a hosted runner has /Applications/Xcode_26.6.app, not Xcode.app); inside an app, its Contents holds the frameworks the tools load
  const chosen = selected === null ? [] : [selected.endsWith("/Contents/Developer") ? selected.slice(0, -"/Developer".length) : selected];
  const all = [...chosen, "/Library/Developer/CommandLineTools", "/Applications/Xcode.app/Contents", "/Library/Preferences/com.apple.dt.Xcode.plist"];
  return [...new Set(all)].filter((p) => exists(p));
}

/** The developer folder the shim resolves (`xcode-select -p`), or null where there is none or the tool is missing. */
export function selectedDeveloperDir(): string | null {
  try {
    const r = spawnSync("/usr/bin/xcode-select", ["-p"], { encoding: "utf8", timeout: 3000 });
    const out = r.status === 0 ? r.stdout.trim() : "";
    return out.startsWith("/") ? out : null;
  } catch { return null; }
}

export async function defaultSandbox(o: DefaultSandboxOptions): Promise<DefaultSandbox> {
  const platform = o.platform ?? process.platform;
  const egress: WallEgress = o.egressHosts ? { allow: [...o.egressHosts], rule: { egress: "list", allow: [...o.egressHosts] } } : (o.egress ?? wallEgress());
  const hosts = egress.allow;
  const node = o.node ?? process.execPath;
  const unavailable = (reason: string): DefaultSandbox => ({ plan: { sandbox: { kind: "server", reason }, dataDir: o.dataDir, egressHosts: hosts }, close: async () => undefined });
  const done = (sandbox: EngineSandbox, close: () => Promise<void>, openWall: NonNullable<SandboxPlan["openWall"]>): DefaultSandbox => ({ plan: { sandbox, dataDir: o.dataDir, egressHosts: hosts, egressRule: egress.rule, openWall }, close });
  const watched = (onEvent?: (e: EgressEvent) => void) => (onEvent ? { egress: { onEvent } } : {});
  if (platform === "linux") {
    if (!(o.bwrapPaths ?? BWRAP).some((p) => fs.existsSync(p))) return unavailable("bubblewrap (bwrap) is not installed on this server, so CLI engines cannot be sandboxed");
    const bw = (dir: string): EngineSandbox => ({ kind: "bwrap", wallDir: dir, node, ...(o.programRead ? { programRead: o.programRead } : {}) });
    const wall = await startNetWall({ ...egress });
    // a turn's own wall: the rule it carries (the Space's choice when it started) and its own record of where it went
    const openWall = async (e: WallEgress, onEvent?: (ev: EgressEvent) => void): Promise<OpenedWall> => { const w = await startNetWall({ ...e, ...watched(onEvent) }); return { sandbox: bw(w.dir), close: () => w.close() }; };
    return done(bw(wall.dir), () => wall.close(), openWall);
  }
  if (platform === "darwin") {
    const proxy = createEgressProxy({ ...egress });
    const { port } = await proxy.listen();
    // Seatbelt denies reads by default: the program being run (this Node, and the CLI's install folders) must be readable.
    const home = process.env["HOME"] ?? "/";
    const programRead = [...(o.programRead ?? []), ...appleDeveloperRoots(), path.dirname(path.dirname(node)), path.join(home, ".local"), "/opt/homebrew", "/usr/local", ...cliInstallRoots({ PATH: enginePath(process.env, home) }, home)].filter((p) => p !== "/");
    const openWall = async (e: WallEgress, onEvent?: (ev: EgressEvent) => void): Promise<OpenedWall> => {
      const p = createEgressProxy({ ...e, ...(onEvent ? { onEvent } : {}) });
      const l = await p.listen();
      return { sandbox: { kind: "seatbelt", proxyPort: l.port, programRead }, close: () => p.close() };
    };
    return done({ kind: "seatbelt", proxyPort: port, programRead }, () => proxy.close(), openWall);
  }
  return unavailable(`CLI engines cannot be sandboxed on ${platform}`);
}
