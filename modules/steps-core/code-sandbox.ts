// The Run code step's sandbox (spec 2.12, 4.17). The code runs in the same bubblewrap sandbox the engine uses for CLI engines (sandbox/src/net/bwrap.ts): a new process, its own namespaces, files read-only
// except one folder made for this run, and a network that is only a unix socket to an egress proxy. The proxy lets through the hosts the step names and nothing else, resolves each name once and refuses a
// private, loopback or metadata address, so a name that points inside is refused (the same rule as the public fetcher). With no hosts named the proxy allows nothing and the code has no network at all.
//   limits   10 seconds of processor time (ulimit -t), a 30 second wall clock for the run, a 96 MB V8 heap (Node cannot start under an address-space limit, so memory is the heap cap), 1 MB of output.
//   node     --permission with the run folder as the only readable and writable path: no child process, no worker, no other file, as a second wall inside the first.
//   never    node:vm. Where bwrap is not available the step is refused (codeAvailability says why); nothing falls back to running the code in the daemon.
// The input and the source are files in the run folder; the result is a file in it. No environment variable, key or Vault value of the daemon reaches the process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startNetWall, bwrapWallCommand, validHostPattern } from "../../sandbox/src/index.ts";
import type { NetWall, NetWallOptions, Roots, SandboxSpec } from "../../sandbox/src/index.ts";
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
  heapMb?: number;
  /** Tests: how the egress proxy resolves a name and dials an address (a stand-in for the internet). Default: the system's. */
  egress?: NetWallOptions["egress"];
}

export const LIMITS = Object.freeze({ cpuSeconds: 10, wallMs: 30_000, heapMb: 96, outputBytes: 1_000_000, sourceChars: 20_000, hosts: 10 });
const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];
const MAX_LOGS = 50;
const MAX_LOG = 500;
const MAX_RUNNING = 4;

let host: CodeHost | null = null;
let running = 0;
const waiting: Array<() => void> = [];

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
  if (typeof text !== "string") throw new Error("Run code must return JSON.");
  if (Buffer.byteLength(text) > MAX_OUT) throw new Error("Run code returned more than 1 MB.");
  finish({ ok: true, text });
} catch (e) {
  finish({ ok: false, message: String((e && e.message) || e).slice(0, 500) });
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
    net = await startNetWall({ allow: hosts, ...(h.egress ? { egress: h.egress } : {}) });
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
    const argv = ["/bin/sh", "-c", `ulimit -t ${cpu}; exec "$@"`, "sh", node, ...nodeFlags(dir, heap), path.join(dir, "runner.mjs"), dir];
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
    return readResult(dir, outcome, cpu, heap);
  } finally {
    await net?.close().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    release();
  }
}

export function readResult(dir: string, o: { code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }, cpu: number, heap: number): CodeResult {
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
    const tail = o.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300);
    throw stepError("validation.bad_input", `The code did not finish.${tail ? ` ${tail}` : ""}`, false);
  }
  let parsed: { ok?: boolean; text?: string; message?: string; logs?: unknown };
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { throw stepError("validation.bad_input", "Run code must return JSON.", false); }
  const logs = Array.isArray(parsed.logs) ? parsed.logs.filter((l): l is string => typeof l === "string").slice(0, MAX_LOGS) : [];
  if (parsed.ok !== true) throw stepError("validation.bad_input", parsed.message ?? "The code failed.", false);
  try { return { result: JSON.parse(parsed.text ?? "null") as unknown, logs }; } catch { throw stepError("validation.bad_input", "Run code must return JSON.", false); }
}
