// CLI engines on Windows run in a Linux that Vyre imports into WSL2 (docs/windows-engine-sandbox.md, option B), inside the same bubblewrap and net wall as on a Linux server. This is the Windows
// side: is WSL2 on, the distribution (pins.ts) imported and set up once, and the agent (agent.ts) started inside it. The agent holds the net wall and relays the MCP sockets of the sandboxes. Its
// only link to the daemon is its own stdin and stdout, so there is no port for anything else on the computer, or in the VM, to reach. Each MCP connection still starts with its session's token,
// and the daemon checks it (modules/engine/mcp-bridge.ts mcpConnection).
//
// Nothing here needs admin. Turning WSL on needs it once (`wsl --install --no-distribution`, then a restart); until then CLI engines refuse with sandbox.wsl_off and say how.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxError } from "../types.ts";
import { DISTRO_HOSTS, DISTRO_PIN } from "./pins.ts";
import type { DistroPin } from "./pins.ts";

export const wslExe = (env: Readonly<Record<string, string | undefined>> = process.env): string => path.win32.join(env["SystemRoot"] ?? env["SYSTEMROOT"] ?? "C:\\Windows", "System32", "wsl.exe");

/** What `wsl.exe` printed and how it ended. WSL_UTF8=1 makes it print UTF-8, not UTF-16. */
export interface WslResult { status: number | null; stdout: string; stderr: string; error?: Error }
export type WslRunSync = (args: readonly string[], timeoutMs: number) => WslResult;
export type WslRun = (args: readonly string[], timeoutMs: number) => Promise<WslResult>;

const WSL_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, WSL_UTF8: "1" });

export const runWslSync: WslRunSync = (args, timeoutMs) => {
  const r = spawnSync(wslExe(), [...args], { encoding: "utf8", env: WSL_ENV(), timeout: timeoutMs, windowsHide: true });
  return { status: r.status, stdout: (r.stdout ?? "").replace(/\0/g, ""), stderr: (r.stderr ?? "").replace(/\0/g, ""), ...(r.error ? { error: r.error } : {}) };
};

/** A long `wsl.exe` call (import, set-up) that never blocks the daemon's event loop. Killed at the deadline. */
export const runWsl: WslRun = (args, timeoutMs) => new Promise((resolve) => {
  const p = spawn(wslExe(), [...args], { env: WSL_ENV(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  p.stdout.setEncoding("utf8").on("data", (d: string) => { stdout += d; });
  p.stderr.setEncoding("utf8").on("data", (d: string) => { stderr += d; });
  const t = setTimeout(() => p.kill(), timeoutMs);
  p.once("error", (error) => { clearTimeout(t); resolve({ status: null, stdout, stderr, error }); });
  p.once("close", (status) => { clearTimeout(t); resolve({ status, stdout: stdout.replace(/\0/g, ""), stderr: stderr.replace(/\0/g, "") }); });
});

export type WslState = { on: true } | { on: false; why: "missing" | "off" };

/** Is WSL there and on? `wsl --status` exits 0 only when it is installed and its platform is on. */
export function wslState(run: WslRunSync = runWslSync): WslState {
  const r = run(["--status"], 15_000);
  if (r.error) return { on: false, why: "missing" };
  return r.status === 0 ? { on: true } : { on: false, why: "off" };
}

let cached: WslState | undefined;
/** wslState, asked once per process: turning WSL on needs a restart, and the daemon starts again after one. */
export function wslOn(run?: WslRunSync): boolean {
  cached ??= process.platform === "win32" || run ? wslState(run) : { on: false, why: "missing" };
  return cached.on;
}
/** Forget the answer (tests). */
export function forgetWslState(): void { cached = undefined; }

/** What a person does to turn WSL on: one line each, shown with "Turn on WSL". */
export const TURN_ON_WSL_STEPS: readonly string[] = [
  "Open the Start menu, type PowerShell, and choose Run as administrator.",
  "Run: wsl --install --no-distribution",
  "Restart the computer. Vyre sets up its sandbox by itself on the next Claude Code, Codex or Grok reply.",
];

/** A Windows path as the VM sees it (WSL's automount at /mnt). C:\Users\dana → /mnt/c/Users/dana. A network path has no such place and is refused. */
export function toWslPath(p: string): string {
  const m = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(p);
  if (!m) throw new SandboxError("sandbox.policy", `a WSL sandbox can only hold folders on a drive with a letter: ${p}`);
  const rest = (m[2] ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return `/mnt/${(m[1] as string).toLowerCase()}${rest === "" ? "" : `/${rest}`}`;
}

/** The architecture of the distribution for this computer. */
export const distroArch = (arch: string = process.arch): "x64" | "arm64" | null => (arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null);

export interface EnsureDistroOptions {
  /** A folder on this computer for the download and the distribution's disk (not roaming: %LOCALAPPDATA%). */
  root: string;
  pin?: DistroPin;
  fetch?: typeof fetch;
  run?: WslRun;
  arch?: "x64" | "arm64" | null;
  /** "import" the first time (a download and a few minutes), "start" when it is there. */
  onPhase?: (phase: "import" | "start") => void;
}

const IMPORT_MS = 5 * 60_000;
const SETUP_MS = 10 * 60_000;

/** The set-up run inside the distribution, once: no Windows programs from inside (interop off), the packages, then the stamp. */
export function setupScript(pin: DistroPin): string {
  return [
    "set -e",
    "printf '[interop]\\nenabled=false\\nappendWindowsPath=false\\n[automount]\\nenabled=true\\n' > /etc/wsl.conf",
    `apk add --no-cache ${pin.packages.join(" ")} >/tmp/vyre-apk.log 2>&1 || { tail -5 /tmp/vyre-apk.log; exit 3; }`,
    `id -u ${pin.user} >/dev/null 2>&1 || adduser -D -u 1000 -s /bin/bash ${pin.user}`,
    `printf '%s\\n' '${pin.stamp}' > /etc/vyre-sandbox`,
  ].join("\n");
}

/** Is the distribution imported and set up at this pin? */
async function stampOf(run: WslRun, name: string): Promise<string | null> {
  const listed = await run(["-l", "-q"], 30_000);
  if (!listed.stdout.split(/\r?\n/).map((l) => l.trim()).includes(name)) return null;
  const r = await run(["-d", name, "-u", "root", "--exec", "/bin/cat", "/etc/vyre-sandbox"], 120_000);
  return r.status === 0 ? r.stdout.trim() : "";
}

/** Imports and sets up the distribution when it is not there at this pin. Throws SandboxError sandbox.wsl_setup with what went wrong. */
export async function ensureDistro(o: EnsureDistroOptions): Promise<void> {
  const pin = o.pin ?? DISTRO_PIN;
  const run = o.run ?? runWsl;
  const stamp = await stampOf(run, pin.name);
  if (stamp === pin.stamp) { o.onPhase?.("start"); return; }
  o.onPhase?.("import");
  const fail = (why: string): never => { throw new SandboxError("sandbox.wsl_setup", why); };
  if (stamp !== null) await run(["--unregister", pin.name], 120_000);   // an older pin, or a set-up cut short: nothing in it is kept between turns
  const arch = o.arch === undefined ? distroArch() : o.arch;
  const build = arch === null ? undefined : pin.builds[arch];
  if (!build) fail(`there is no ${pin.version} build for this computer`);
  fs.mkdirSync(o.root, { recursive: true });
  const tar = path.join(o.root, "rootfs.tar.gz");
  await download((build as NonNullable<typeof build>), tar, o.fetch ?? fetch).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
  const disk = path.join(o.root, "disk");
  fs.rmSync(disk, { recursive: true, force: true });
  const imp = await run(["--import", pin.name, disk, tar, "--version", "2"], IMPORT_MS);
  fs.rmSync(tar, { force: true });
  if (imp.status !== 0) fail(`WSL could not import the sandbox: ${(imp.stderr || imp.stdout).trim().split(/\r?\n/).slice(-2).join(" ")}`);
  const set = await run(["-d", pin.name, "-u", "root", "--exec", "/bin/sh", "-c", setupScript(pin)], SETUP_MS);
  if (set.status !== 0) fail(`the sandbox could not be set up (${set.status ?? "timed out"}): ${(set.stdout + set.stderr).trim().split(/\r?\n/).slice(-3).join(" ")}`);
  await run(["--terminate", pin.name], 60_000);   // wsl.conf takes effect at the next start
}

/** The pinned file, from the pinned host only, checked for size and SHA-256 before it is used. */
async function download(build: { url: string; size: number; sha256: string }, to: string, get: typeof fetch): Promise<void> {
  let url = new URL(build.url);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "https:" || !DISTRO_HOSTS.includes(url.hostname)) throw new Error(`the download was sent to ${url.hostname}, which is not Alpine's`);
    const r = await get(url.href, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(r.status)) { const where = r.headers.get("location"); if (!where) throw new Error("the download was redirected nowhere"); url = new URL(where, url); continue; }
    if (!r.ok) throw new Error(`the download answered ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const sum = Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", buf)).toString("hex");
    if (buf.length !== build.size || sum !== build.sha256) throw new Error("the download is not the pinned file, so it was not used");
    fs.writeFileSync(to, buf);
    return;
  }
  throw new Error("the download was redirected too many times");
}

/** The agent's source, beside this file: the VM runs it from the Windows folder through /mnt. */
export const AGENT_PATH = fileURLToPath(new URL("./agent.ts", import.meta.url).href);

/** Options the agent takes: plain data, so they cross into the VM as they are. */
export interface AgentOptions {
  /** The wall's egress, plain JSON (it crosses into the VM): the allow list and the shared rule (egress-policy.ts), the same the Linux wall gets (modules/engine/sandbox-default.ts). */
  wall: { allow: readonly string[]; rule?: unknown };
  /** A folder in the VM's own file system for the wall and the MCP sockets (a unix socket cannot live on /mnt/c), the agent's user's own. */
  base: string;
  /** Tests only: these host names resolve to a public-looking address and connect to 127.0.0.1:<port> in the VM. */
  testRoutes?: Readonly<Record<string, number>>;
}

export interface WslAgent {
  /** The wall's folder in the VM, bound read-only into each sandbox (net/guest.ts GUEST_DIR). */
  wallDir: string;
  /** The VM's /bin and /lib are folders, not links into /usr (bwrap's splitUsr). */
  splitUsr: boolean;
  /** The VM's Node, which runs the guest bridge and the MCP shim inside the sandbox. */
  node: string;
  /** A socket for one MCP session inside the wall's folder; each connection to it is served by `serve` on this side. Answers its name inside the sandbox. */
  openMcp(id: string, serve: (wire: { write(line: string): void; end(): void; destroy(): void }) => { data(chunk: string): void; end(): void }): Promise<string>;
  closeMcp(id: string): void;
  /** The egress policy from now on (sent at each turn's start: Console changes apply at the next turn). */
  setPolicy(wall: AgentOptions["wall"]): void;
  close(): Promise<void>;
  /** Settles when the agent ends (the VM stopped, or close()). */
  exited: Promise<void>;
}

/** Starts the agent in the distribution. Throws sandbox.wsl_start when it is not up in time (the VM's first start after a restart takes seconds, never minutes). */
export async function startWslAgent(o: { name?: string; user?: string; options: AgentOptions; readyMs?: number; agentPath?: string; spawnAgent?: (args: string[]) => import("node:child_process").ChildProcessWithoutNullStreams }): Promise<WslAgent> {
  const name = o.name ?? DISTRO_PIN.name;
  const arg = Buffer.from(JSON.stringify(o.options), "utf8").toString("base64");
  // a test's spawnAgent runs the agent on this computer, where the program has no /mnt path
  const program = o.spawnAgent ? (o.agentPath ?? AGENT_PATH) : toWslPath(o.agentPath ?? AGENT_PATH);
  const args = ["-d", name, "-u", o.user ?? DISTRO_PIN.user, "--cd", "/", "--exec", "/usr/bin/node", program, arg];
  const p = o.spawnAgent ? o.spawnAgent(args) : spawn(wslExe(), args, { env: WSL_ENV(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const send = (m: Record<string, unknown>): void => { if (!p.stdin.destroyed) p.stdin.write(`${JSON.stringify(m)}\n`); };
  const conns = new Map<string, { data(chunk: string): void; end(): void }>();
  const sessions = new Map<string, Parameters<WslAgent["openMcp"]>[1]>();
  const opened = new Map<string, (path: string) => void>();
  let ready: ((r: { wallDir: string; splitUsr: boolean; node: string }) => void) | undefined;
  let err = "";
  p.stderr.setEncoding("utf8").on("data", (d: string) => { err = (err + d).slice(-2000); });
  const exited = new Promise<void>((resolve) => p.once("close", () => resolve()));
  let buf = "";
  p.stdout.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === "") continue;
      let m: { t?: string; s?: string; c?: string; l?: string; path?: string; wallDir?: string; splitUsr?: boolean; node?: string };
      try { m = JSON.parse(line) as typeof m; } catch { continue; }
      if (m.t === "ready" && typeof m.wallDir === "string") ready?.({ wallDir: m.wallDir, splitUsr: m.splitUsr === true, node: m.node ?? "/usr/bin/node" });
      else if (m.t === "mcp-ok" && typeof m.s === "string" && typeof m.path === "string") opened.get(m.s)?.(m.path);
      else if (m.t === "conn" && typeof m.s === "string" && typeof m.c === "string") {
        const serve = sessions.get(m.s);
        const c = m.c;
        if (!serve) { send({ t: "kill", c }); continue; }
        conns.set(c, serve({ write: (l) => send({ t: "l", c, l }), end: () => { send({ t: "end", c }); conns.delete(c); }, destroy: () => { send({ t: "kill", c }); conns.delete(c); } }));
      } else if (m.t === "l" && typeof m.c === "string" && typeof m.l === "string") conns.get(m.c)?.data(`${m.l}\n`);
      else if (m.t === "end" && typeof m.c === "string") conns.get(m.c)?.end();
    }
  });
  const up = await Promise.race([
    new Promise<{ wallDir: string; splitUsr: boolean; node: string }>((resolve) => { ready = resolve; }),
    exited.then(() => null),
    new Promise<"late">((resolve) => { const t = setTimeout(() => resolve("late"), o.readyMs ?? 90_000); t.unref?.(); }),
  ]);
  if (up === null || up === "late") {
    p.kill();
    throw new SandboxError("sandbox.wsl_start", up === "late" ? "the Windows sandbox did not start in time" : `the Windows sandbox stopped as it started: ${err.trim().split(/\r?\n/).slice(-2).join(" ")}`);
  }
  return {
    ...up,
    async openMcp(id, serve) {
      if (!/^[a-z0-9]{6,40}$/.test(id)) throw new SandboxError("sandbox.policy", "an MCP session id is letters and digits");
      sessions.set(id, serve);
      const at = await Promise.race([
        new Promise<string>((resolve) => { opened.set(id, resolve); send({ t: "mcp", s: id }); }),
        new Promise<null>((resolve) => { const t = setTimeout(() => resolve(null), 15_000); t.unref?.(); }),
      ]);
      opened.delete(id);
      if (at === null) { sessions.delete(id); throw new SandboxError("sandbox.wsl_start", "the Windows sandbox did not open the engine's link to Vyre's tools"); }
      return at;
    },
    closeMcp(id) { sessions.delete(id); send({ t: "close", s: id }); },
    setPolicy(wall) { send({ t: "policy", wall }); },
    async close() { p.stdin.end(); await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]); if (p.exitCode === null) p.kill(); },
    exited,
  };
}
