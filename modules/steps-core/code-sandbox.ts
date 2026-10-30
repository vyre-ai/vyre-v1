// The Run code step's sandbox (spec 2.12, 4.17). The code runs in the same bubblewrap sandbox the engine uses for CLI engines (sandbox/src/net/bwrap.ts): a new process, its own namespaces, files read-only
// except one folder made for this run, and a network that is only a unix socket to an egress proxy. The proxy lets through the hosts the step names and nothing else, resolves each name once and refuses a
// private, loopback or metadata address, so a name that points inside is refused (the same rule as the public fetcher). With no hosts named the proxy allows nothing and the code has no network at all.
//   limits   10 seconds of processor time (ulimit -t), a 30 second wall clock for the run, a 64 MB V8 heap and a 640 MB kernel data limit (RLIMIT_DATA, which also covers Buffers and ArrayBuffers; V8 reserves its 128 MB code range, and more to align it, before any code runs, so a limit near the heap size stops Node at start: "Failed to reserve virtual memory for CodeRange"; the heap flag is what bounds the code's own objects), 1 MB of output.
//   node     --permission with the run folder as the only readable and writable path: no child process, no worker, no other file, as a second wall inside the first.
//   never    node:vm. Where bwrap is not available the step is refused (codeAvailability says why); nothing falls back to running the code in the daemon.
// The input and the source are files in the run folder; the result is a file in it. No environment variable, key or Vault value of the daemon reaches the process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startNetWall, bwrapWallCommand, validHostPattern } from "../../sandbox/src/index.ts";
import type { NetWall, NetWallOptions, Roots, SandboxSpec } from "../../sandbox/src/index.ts";
import dns from "node:dns/promises";
import { refusesAddress } from "../../lib/address-guard.ts";
import { stepError } from "./projections.ts";

/** What the host gives the module: where to make run folders, and how to find bwrap and Node. Tests override the limits. */
export interface CodeHost {
  dataDir: string;
  platform?: NodeJS.Platform;
  bwrapPaths?: readonly string[];
  node?: string;
  /** Set by a host that has decided the sandbox cannot be used here; the reason is shown to the person. */
  unavailable?: string;
  /** Extra read-only folders for the Node install, when it is not under /usr. */
  programRead?: readonly string[];
  cpuSeconds?: number;
  wallMs?: number;
  /** Tests only: when the sandbox ends without a result, the exit status, signal and the sandbox's own stderr go into the error message. Never set by a host that serves people. */
  diagnose?: boolean;
  heapMb?: number;
  /** The kernel limit on the process's data (RLIMIT_DATA: heap, Buffers and ArrayBuffers). Default 640 MB: V8's code range reservation, the 64 MB heap, thread stacks and the runtime's own come first, and the rest is what Buffers may take. */
  dataMb?: number;
  /** Tests: how the egress proxy resolves a name and dials an address (a stand-in for the internet). Default: the system's. */
  egress?: NetWallOptions["egress"];
}

export const LIMITS = Object.freeze({ cpuSeconds: 10, wallMs: 30_000, heapMb: 64, dataMb: 640, outputBytes: 1_000_000, sourceChars: 20_000, hosts: 10 });
const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];
const MAX_LOGS = 50;
const MAX_LOG = 500;
const MAX_RUNNING = 4;

let host: CodeHost | null = null;
let running = 0;
const waiting: Array<() => void> = [];

/**
 * The name lookup the egress proxy uses. The proxy already refuses the addresses of its own list; this adds lib/address-guard.ts, the one list the public fetcher uses (tailnet 100.64/10, 198.18/15,
 * multicast and reserved, "::", NAT64 and the rest), and answers no address at all when any address of a name is on it, so a name that points inside is refused whole.
 */
export function guardedLookup(base?: (host: string) => Promise<readonly string[]>): (host: string) => Promise<readonly string[]> {
  const resolve = base ?? (async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map((r) => r.address));
  return async (host) => {
    const ips = await resolve(host);
    return ips.some((ip) => refusesAddress(ip)) ? [] : ips;
  };
}

export function setCodeHost(next: CodeHost | null): void { host = next; }

/** Why Run code cannot run on this server, or null when it can. */
export function codeAvailability(h: CodeHost | null = host): string | null {
  if (!h) return "Run code needs the agent runtime, which this server has not started.";
  if (h.unavailable) return h.unavailable;
  if ((h.platform ?? process.platform) !== "linux") return "Run code needs a Linux server with bubblewrap. This computer cannot sandbox it, so the step is off here.";
  if (!(h.bwrapPaths ?? BWRAP).some((p) => fs.existsSync(p))) return "Run code needs bubblewrap (bwrap) on the server, and it is not installed. Install it, or remove the Run code step.";
  return null;
}

/** The runner. It reads the input and the source from the run folder, calls the source as an async function body, and writes one result file. */
export const RUNNER = `import fs from "node:fs";
const dir = process.argv[2];
const MAX_OUT = ${LIMITS.outputBytes};
const logs = [];
const show = (x) => { if (typeof x === "string") return x; try { return JSON.stringify(x); } catch { return String(x); } };
const log = (...a) => { if (logs.length < ${MAX_LOGS}) logs.push(a.map(show).join(" ").slice(0, ${MAX_LOG})); };
console.log = console.info = console.warn = console.error = console.debug = log;
const finish = (o) => { fs.writeFileSync(dir + "/result.json", JSON.stringify({ ...o, logs })); };
if (process.env.VYRE_CODE_NET !== "1") delete globalThis.fetch;
try {
  const input = JSON.parse(fs.readFileSync(dir + "/input.json", "utf8"));
  const source = fs.readFileSync(dir + "/code.js", "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("input", "log", '"use strict";\\n' + source);
  const value = await fn(input, log);
  const text = JSON.stringify(value === undefined ? null : value);
  if (typeof text !== "string") throw Object.assign(new Error("x"), { name: "NotJson" });
  if (Buffer.byteLength(text) > MAX_OUT) throw Object.assign(new Error("x"), { name: "OutputTooLarge" });
  finish({ ok: true, text });
} catch (e) {
  finish({ ok: false, name: /allocation failed|out of memory|Invalid array length/i.test(String((e && e.message) || e)) ? "OutOfMemory" : String((e && e.name) || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) });
}
`;

/** How Node is started inside the sandbox: the run folder is the only path it may read or write, and the heap is capped. */
export const nodeFlags = (dir: string, heapMb: number): string[] => ["--permission", `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`, `--max-old-space-size=${heapMb}`, "--max-semi-space-size=4"];

async function turn(): Promise<() => void> {
  if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  return () => { running -= 1; waiting.shift()?.(); };
}

export interface CodeResult { result: unknown; logs: string[] }

function hostsOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw stepError("validation.bad_input", "Allowed hosts must be a list of host names.", false);
  if (value.length > LIMITS.hosts) throw stepError("validation.bad_input", `Run code may name at most ${LIMITS.hosts} hosts.`, false);
  const out: string[] = [];
  for (const raw of value) {
    const h = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!validHostPattern(h)) throw stepError("validation.bad_input", `${typeof raw === "string" ? raw : "That"} is not a host name. Use api.example.com or *.example.com.`, false);
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

export async function runInSandbox(source: unknown, input: unknown, hostsRaw?: unknown): Promise<CodeResult> {
  const h = host;
  const why = codeAvailability(h);
  if (why !== null || !h) throw stepError("run.no_code", why ?? "Run code is not available.", false);
  if (typeof source !== "string" || !source.trim()) throw stepError("validation.bad_input", "Run code needs source.", false);
  if (source.length > LIMITS.sourceChars) throw stepError("validation.bad_input", `Run code is longer than ${LIMITS.sourceChars} characters.`, false);
  const hosts = hostsOf(hostsRaw);
  let inputText: string;
  try { inputText = JSON.stringify(input ?? null); } catch { throw stepError("validation.bad_input", "The input to Run code must be JSON.", false); }
  if (typeof inputText !== "string" || Buffer.byteLength(inputText) > LIMITS.outputBytes) throw stepError("validation.bad_input", "The input to Run code is over 1 MB.", false);

  const release = await turn();
  const codeRoot = path.join(h.dataDir, "code");
  fs.mkdirSync(codeRoot, { recursive: true });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(codeRoot, "run-")));
  let net: NetWall | undefined;
  try {
    fs.chmodSync(dir, 0o755);
    fs.writeFileSync(path.join(dir, "runner.mjs"), RUNNER, { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "code.js"), source, { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "input.json"), inputText, { mode: 0o644 });
    // one proxy for this run: it allows the named hosts and is closed when the run ends
    net = await startNetWall({ allow: hosts, egress: { ...(h.egress ?? {}), lookup: guardedLookup(h.egress?.lookup) } });
    const node = h.node ?? process.execPath;
    const heap = h.heapMb ?? LIMITS.heapMb;
    const cpu = h.cpuSeconds ?? LIMITS.cpuSeconds;
    const scratch = path.join(h.dataDir, "code-scratch");
    fs.mkdirSync(scratch, { recursive: true });
    const roots: Roots = { work: [codeRoot], scratch: [scratch] };
    const spec: SandboxSpec = {
      id: `vyre-code-${path.basename(dir).slice(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`, person: "code", kind: "bwrap", scratch: fs.realpathSync(scratch),
      mounts: [{ host: dir, mode: "rw" }], egressHosts: hosts, env: hosts.length > 0 ? { NODE_USE_ENV_PROXY: "1", VYRE_CODE_NET: "1" } : {},
    };
    // ulimit -t counts processor seconds: a loop is killed by the kernel, a wait on the network is not counted (the wall clock below ends that).
    const dataKb = (h.dataMb ?? LIMITS.dataMb) * 1024;
    // ulimit -d bounds everything the process maps for data (brk and private writable mappings), so a Buffer or ArrayBuffer loop outside the V8 heap is stopped by the kernel too
    const argv = ["/bin/sh", "-c", `ulimit -t ${cpu}; ulimit -d ${dataKb}; exec "$@"`, "sh", node, ...nodeFlags(dir, heap), path.join(dir, "runner.mjs"), dir];
    const w = bwrapWallCommand(spec, roots, argv, { wallDir: net.dir, node, ...(h.programRead ? { programRead: h.programRead } : {}) });
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }>((resolve) => {
      const p = spawn(w.cmd, w.args, { env: {}, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      let timedOut = false;
      p.stderr.on("data", (d: Buffer) => { if (stderr.length < 4_000) stderr += d.toString("utf8"); });
      const t = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, h.wallMs ?? LIMITS.wallMs);
      p.on("error", (err) => { clearTimeout(t); resolve({ code: null, signal: null, stderr: `${stderr}${err.message}`, timedOut }); });
      p.on("close", (code, signal) => { clearTimeout(t); resolve({ code, signal, stderr, timedOut }); });
    });
    return readResult(dir, outcome, cpu, heap, 128, h.diagnose === true);
  } finally {
    await net?.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    release();
  }
}

export function readResult(dir: string, o: { code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }, cpu: number, heap: number, memoryMb = heap, diagnose = false): CodeResult {
  const file = path.join(dir, "result.json");
  let raw: string | null = null;
  try {
    const size = fs.statSync(file).size;
    if (size > LIMITS.outputBytes + 20_000) throw stepError("validation.too_large", "Run code returned more than 1 MB.", false);
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as { error?: unknown }).error) throw e;
  }
  if (raw === null) {
    if (o.timedOut) throw stepError("timeout.deadline", "Run code took too long.", false);
    if (o.signal === "SIGKILL" || o.signal === "SIGXCPU" || o.code === 137 || o.code === 152) throw stepError("timeout.deadline", `Run code used more than ${cpu} seconds of processor time.`, false);
    if (/heap out of memory|allocation failed|ERR_WORKER_OUT_OF_MEMORY/i.test(o.stderr) || o.signal === "SIGABRT" || o.code === 134) throw stepError("validation.bad_input", `Run code used more than ${heap} MB of memory.`, false);
    throw stepError("validation.bad_input", `The code did not finish.${diagnose ? ` [exit ${String(o.code)} signal ${String(o.signal)} stderr ${JSON.stringify(o.stderr.slice(0, 1500))}]` : ""}`, false);
  }
  let parsed: { ok?: boolean; text?: string; name?: string; message?: string; logs?: unknown };
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { throw stepError("validation.bad_input", "Run code must return JSON.", false); }
  const logs = Array.isArray(parsed.logs) ? parsed.logs.filter((l): l is string => typeof l === "string").slice(0, MAX_LOGS) : [];
  // the words of the failure are the code's own and may hold the data it was given: only its kind of error is passed on
  if (parsed.ok !== true) {
    if (parsed.name === "NotJson") throw stepError("validation.bad_input", "Run code must return JSON.", false);
    if (parsed.name === "OutOfMemory") throw stepError("validation.bad_input", `Run code used more than ${memoryMb} MB of memory.`, false);
    if (parsed.name === "OutputTooLarge") throw stepError("validation.too_large", "Run code returned more than 1 MB.", false);
    throw stepError("validation.bad_input", `The code threw ${parsed.name ?? "an error"}.`, false);
  }
  try { return { result: JSON.parse(parsed.text ?? "null") as unknown, logs }; } catch { throw stepError("validation.bad_input", "Run code must return JSON.", false); }
}
