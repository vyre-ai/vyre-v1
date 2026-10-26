// from vyre 0.6.9 core/config/index.js@dbd2dfbab (untilde, home, paths; the rest of that file is 0.6 settings and does not come over)
// Where vyred keeps things and what it was told at start. One data directory per Space host:
//   events.db   the event log (kernel, single writer)     modules.db  every module's tables (ctx.db)     logs.db  the log sink
//   vyred.pid   the running process                       vyred.json  port and url for the CLI           admin.token  the local admin bearer token (0600)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Role = "space" | "device";

/** Resolve a leading ~ against the home directory. */
export const untilde = (p: string): string => p.replace(/^~(?=$|\/)/, os.homedir());

/** The data directory: --data-dir, else VYRE_DATA_DIR, else ~/.vyre. */
export function dataHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(untilde(env["VYRE_DATA_DIR"] || path.join(os.homedir(), ".vyre")));
}

export interface DaemonPaths {
  root: string; events: string; modules: string; logs: string; logDir: string; pid: string; info: string; adminToken: string;
}
export function pathsFor(root: string): DaemonPaths {
  return {
    root, events: path.join(root, "events.db"), modules: path.join(root, "modules.db"), logs: path.join(root, "logs.db"), logDir: path.join(root, "logs"),
    pid: path.join(root, "vyred.pid"), info: path.join(root, "vyred.json"), adminToken: path.join(root, "admin.token"),
  };
}

export function parseRoles(text: string): Role[] {
  const out: Role[] = [];
  for (const part of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part !== "space" && part !== "device") throw new Error(`unknown role "${part}": use space, device or space,device`);
    if (!out.includes(part)) out.push(part);
  }
  if (!out.length) throw new Error("a role is needed: space, device or space,device");
  return out;
}

export interface DaemonConfig {
  roles: Role[];
  dataDir: string;
  /** the Space id; read from events.db when absent */
  space: string | null;
  host: string;
  /** 0 picks a free port */
  port: number;
  version: string;
  /** the person the local admin token acts as; defaults to the owner of the Space resource */
  owner: string | null;
  /** Caddy admin API, for the caddy probe */
  caddyAdmin: string;
  /** relay base URL; the time-skew probe reads its Date header */
  relayUrl: string | null;
  /** the address people reach this Space at (own domain or relay name); the local URL when absent */
  address: string | null;
  /** `personal` while this daemon hosts a Personal Space (one person's desktop, ARCH 5.13); anything else, or absent, is a Team Space. */
  spaceKind?: "personal" | "team";
}

export const DEFAULTS = { host: "127.0.0.1", port: 8420, caddyAdmin: "http://127.0.0.1:2019" } as const;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};

/** `vyred --role space --data-dir D --space spc_x --port 8420 --host 127.0.0.1`; every flag has an env twin (VYRE_ROLE, VYRE_DATA_DIR, VYRE_SPACE, VYRE_PORT, VYRE_HOST). */
function spaceKindOf(text: string | undefined): { spaceKind?: "personal" | "team" } {
  if (text === undefined || text === "") return {};
  if (text !== "personal" && text !== "team") throw new Error(`--space-kind must be personal or team, got "${text}"`);
  return { spaceKind: text };
}

export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, version = "0.0.0"): DaemonConfig {
  const portText = flag(argv, "port") ?? env["VYRE_PORT"];
  const port = portText === undefined ? DEFAULTS.port : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be 0 to 65535, got "${String(portText)}"`);
  return {
    roles: parseRoles(flag(argv, "role") ?? env["VYRE_ROLE"] ?? "space"),
    dataDir: path.resolve(untilde(flag(argv, "data-dir") ?? dataHome(env))),
    space: flag(argv, "space") ?? env["VYRE_SPACE"] ?? null,
    host: flag(argv, "host") ?? env["VYRE_HOST"] ?? DEFAULTS.host,
    port,
    version,
    owner: flag(argv, "owner") ?? env["VYRE_OWNER"] ?? null,
    caddyAdmin: flag(argv, "caddy-admin") ?? env["VYRE_CADDY_ADMIN"] ?? DEFAULTS.caddyAdmin,
    relayUrl: flag(argv, "relay") ?? env["VYRE_RELAY_URL"] ?? null,
    address: flag(argv, "address") ?? env["VYRE_ADDRESS"] ?? null,
    ...spaceKindOf(flag(argv, "space-kind") ?? env["VYRE_SPACE_KIND"]),
  };
}

/** Make the data directory (0700) and its log directory. */
export function ensureDirs(p: DaemonPaths): void {
  fs.mkdirSync(p.root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(p.logDir, { recursive: true, mode: 0o700 });
}

/** The local admin token: VYRE_ADMIN_TOKEN, else the file, else a new random one written 0600. */
export function ensureAdminToken(p: DaemonPaths, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["VYRE_ADMIN_TOKEN"];
  if (fromEnv) return fromEnv;
  try {
    const t = fs.readFileSync(p.adminToken, "utf8").trim();
    if (t) return t;
  } catch { /* first start */ }
  const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  fs.writeFileSync(p.adminToken, `${token}\n`, { mode: 0o600 });
  return token;
}

export interface DaemonInfo { pid: number; url: string; port: number; roles: Role[]; space: string | null; version: string; startedAt: number }
export function writeInfo(p: DaemonPaths, info: DaemonInfo): void {
  fs.writeFileSync(p.pid, `${info.pid}\n`);
  fs.writeFileSync(p.info, JSON.stringify(info));
}
export function readInfo(p: DaemonPaths): DaemonInfo | null {
  try { return JSON.parse(fs.readFileSync(p.info, "utf8")) as DaemonInfo; } catch { return null; }
}
export function clearInfo(p: DaemonPaths): void {
  fs.rmSync(p.pid, { force: true });
  fs.rmSync(p.info, { force: true });
}
/** Is this pid a live process? (EPERM means it is.) */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}
