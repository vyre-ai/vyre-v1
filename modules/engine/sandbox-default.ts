// The sandbox a daemon uses for CLI engines when the host gave no plan of its own (P-L2_23): without one, agents on a CLI account could not start at all. Linux with bubblewrap gets bwrap and
// the network wall (an egress proxy behind a unix socket); a Mac gets Seatbelt with an egress proxy on loopback. Where the platform truly cannot sandbox, the plan says so and every CLI turn
// refuses with sandbox.unavailable; it never falls back to running the engine unwrapped. The wall lives as long as the daemon: close() stops it.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createEgressProxy, startNetWall } from "../../sandbox/src/index.ts";
import { LABELS, ensureLowrun, lowrunPossible, setLabel } from "../../sandbox/src/win/lowrun.ts";
import { privateBash } from "../../sandbox/src/win/msys.ts";
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
  /** Windows: where Vyre keeps the engine's sandbox helper. Default %LOCALAPPDATA%\ai.vyre.desktop\bin. */
  winBin?: string;
  /** Windows: the folders the person added to Vyre, which the engine may change (besides its work folder, home and temp). */
  writable?: readonly string[];
  /** Windows: Vyre's own folders a Low engine may not read. Default: the app's data folder (the dataDir's parent when it is ai.vyre.desktop) and %LOCALAPPDATA%\ai.vyre.desktop. */
  privateDirs?: readonly string[];
}

/** Vyre's own folders on Windows: the app's data folder (personal\ and vyred\ under %APPDATA%\ai.vyre.desktop) and its local folder (the webview's profile, the helper). */
export function vyrePrivateDirs(dataDir: string, env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const parent = path.win32.dirname(dataDir);
  const own = path.win32.basename(parent).toLowerCase() === "ai.vyre.desktop" ? parent : dataDir;
  const local = env["LOCALAPPDATA"] ? path.win32.join(env["LOCALAPPDATA"], "ai.vyre.desktop") : null;
  return [own, ...(local && fs.existsSync(local) ? [local] : [])];
}

/**
 * Keeps Vyre's own files from an engine at Low integrity (the at-rest audit: admin.token, seal.key, vault-filler.key, relay.key and the databases are files the person's account can read). The
 * private folders get "no read up"; the engines folder is readable but not writable; the folders an engine may change are labelled Low when it starts (sandbox.ts lowWrap). Once per computer and
 * label version: a marker beside the helper says it was done.
 */
export function protectVyreData(helper: string, binDir: string, dirs: readonly string[], readable: readonly string[]): void {
  const marker = path.join(binDir, `protected-${Buffer.from(JSON.stringify([LABELS, dirs, readable])).toString("base64url").slice(0, 40)}`);
  if (fs.existsSync(marker)) return;
  for (const d of dirs) setLabel(helper, d, "private");
  for (const d of readable) setLabel(helper, d, "read");
  fs.writeFileSync(marker, "");
}

/** Where the Windows helper lives: Vyre's own folder, never the roaming profile. */
export const winBinDir = (env: Readonly<Record<string, string | undefined>> = process.env): string => path.win32.join(env["LOCALAPPDATA"] ?? env["APPDATA"] ?? "C:\\", "ai.vyre.desktop", "bin");

/** The wall's egress options, built in this one place for every platform: plain data, the policy of the turn that starts (lane l-openweb's shared policy lands here). */
export function wallOptions(hosts: readonly string[]): { allow: readonly string[] } {
  return { allow: [...hosts] };
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

/**
 * Why CLI engines cannot be sandboxed on this computer, in one line a person can read, or null where they can. The same answer defaultSandbox gives: a turn refuses with it (sandbox.unavailable), the
 * account picker passes over CLI accounts for it (runnable-account.ts), and the AI accounts page shows it as what the account needs (engine.providers.list). Never a reason to run an engine unwrapped.
 */
export function cliSandboxGap(o: { platform?: NodeJS.Platform; bwrapPaths?: readonly string[] } = {}): string | null {
  const platform = o.platform ?? process.platform;
  if (platform === "darwin") return null;
  if (platform === "linux") return (o.bwrapPaths ?? BWRAP).some((p) => fs.existsSync(p)) ? null : "bubblewrap (bwrap) is not installed on this server, so CLI engines cannot be sandboxed";
  // a Personal Space runs them at Low integrity in a Job Object (sandbox/src/win), built with the compiler Windows ships
  if (platform === "win32") return lowrunPossible(winBinDir()) ? null : "this Windows has no .NET Framework compiler, which Vyre needs to set up the engine's sandbox";
  return `CLI engines cannot be sandboxed on ${platform}`;
}

export async function defaultSandbox(o: DefaultSandboxOptions): Promise<DefaultSandbox> {
  const platform = o.platform ?? process.platform;
  const hosts = o.egressHosts ?? ENGINE_EGRESS_HOSTS;
  const node = o.node ?? process.execPath;
  const unavailable = (reason: string): DefaultSandbox => ({ plan: { sandbox: { kind: "server", reason }, dataDir: o.dataDir, egressHosts: hosts }, close: async () => undefined });
  const done = (sandbox: EngineSandbox, close: () => Promise<void>): DefaultSandbox => ({ plan: { sandbox, dataDir: o.dataDir, egressHosts: hosts }, close });
  const gap = cliSandboxGap({ platform, ...(o.bwrapPaths ? { bwrapPaths: o.bwrapPaths } : {}) });
  if (gap !== null) return unavailable(gap);
  const policy = wallOptions(hosts);
  if (platform === "win32") {
    const bin = o.winBin ?? winBinDir();
    const helper = await ensureLowrun(bin);
    const msys = path.win32.join(path.win32.dirname(bin), "msys");
    const bash = await privateBash(msys).catch(() => null);
    // Vyre's folders (and the data folder itself, which the work folders are under) private; the roots an engine works under, its engines and its Git Bash readable
    const priv = [...new Set([...(o.privateDirs ?? vyrePrivateDirs(o.dataDir)), o.dataDir])];
    protectVyreData(helper, bin, priv, [path.join(o.dataDir, "work"), path.join(o.dataDir, "scratch"), path.join(o.dataDir, "engines"), ...(bash ? [msys] : [])]);
    const proxy = createEgressProxy({ ...policy });
    const { port } = await proxy.listen();
    return done({ kind: "lowil", helper, proxyPort: port, ...(o.writable ? { writable: o.writable } : {}), ...(bash ? { bash } : {}) }, () => proxy.close());
  }
  if (platform === "linux") {
    const wall = await startNetWall({ ...policy });
    return done({ kind: "bwrap", wallDir: wall.dir, node, ...(o.programRead ? { programRead: o.programRead } : {}) }, () => wall.close());
  }
  if (platform === "darwin") {
    const proxy = createEgressProxy({ ...policy });
    const { port } = await proxy.listen();
    // Seatbelt denies reads by default: the program being run (this Node, and the CLI's install folders) must be readable.
    const home = process.env["HOME"] ?? "/";
    const programRead = [...(o.programRead ?? []), ...appleDeveloperRoots(), path.dirname(path.dirname(node)), path.join(home, ".local"), "/opt/homebrew", "/usr/local", ...cliInstallRoots({ PATH: enginePath(process.env, home) }, home)].filter((p) => p !== "/");
    return done({ kind: "seatbelt", proxyPort: port, programRead }, () => proxy.close());
  }
  return unavailable(`CLI engines cannot be sandboxed on ${platform}`);
}
