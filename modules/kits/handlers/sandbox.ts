// Kit script sandbox (spec 2.21 "Sandbox", 4.16; ARCH 7.6): a Kit script runs in a node:vm realm inside a worker thread and can reach the Space only through api.call.
// No network, no file system, no process, no require and no secrets exist in the realm; each attempt to reach one is recorded as a denial (the handler turns denials into sandbox.denied events).
// How the realm is kept closed:
//   - A fresh vm context has no Node globals. The names a script is likely to try (fetch, require, process, XMLHttpRequest, WebSocket) are replaced by stubs that report a denial and throw.
//   - Nothing from this thread's realm is handed to the script. The two host functions are closed over by code compiled inside the realm, take and return strings only, and answer through a
//     promise made inside the realm; an outer-realm object reachable from a script (a function, a promise, an error) would let it climb out through `.constructor.constructor`.
//   - Code generation from strings and WebAssembly are off in the realm, so eval and new Function are dead. Dynamic import( is refused before the script is compiled.
//   - The worker has capped memory, an empty environment and a wall-clock limit; a synchronous loop is cut by the vm timeout, an endless async wait by terminating the worker.
//   - api.call goes to the main thread, which checks the capability against the script's declared list and a call budget before calling it as the installing principal.
// The same file is the worker's entry: the main thread starts it with `new Worker(import.meta.url)`.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

export interface SandboxOptions {
  /** the body of an async function; `input` and `api` are in scope and the returned value (JSON) is the result */
  source: string;
  input?: unknown;
  /** capabilities the script may call, as declared in its Kit; everything else is denied */
  caps: readonly string[];
  /** calls a capability for the script; a thrown error with a `permission.` code is recorded as a denial */
  call: (cap: string, input: unknown) => Promise<unknown>;
  /** limit on synchronous work between awaits */
  cpuMs?: number;
  /** limit on the whole run */
  wallMs?: number;
  maxCalls?: number;
  maxSourceBytes?: number;
}

export interface SandboxResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** one short line per blocked attempt, in order */
  denials: string[];
  calls: number;
  ms: number;
}

export const DEFAULTS = { cpuMs: 1000, wallMs: 5000, maxCalls: 100, maxSourceBytes: 20_000, maxResultBytes: 1_000_000, memoryMb: 256 };

/** Names a script may try to reach for the outside. Each becomes a stub that reports a denial (see BOOTSTRAP). */
export const DENIED_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "require", "Worker", "process", "module"] as const;

// ---- the realm (runs in the worker) ---------------------------------------------------------------------------

const BOOTSTRAP = `(function (hostCall, hostDeny) {
  "use strict";
  var deny = function (what) { try { hostDeny(String(what)); } catch (e) {} throw new Error(String(what) + " is not available in a Kit script."); };
  var hostOf = function (u) { var m = /^[a-z][a-z0-9+.-]*:\\/\\/([^\\/?#:]+)/i.exec(String(u)); return m ? m[1] : "an address"; };
  var g = globalThis;
  var stub = function (name, fn) { Object.defineProperty(g, name, { value: fn, writable: false, configurable: false, enumerable: false }); };
  stub("fetch", function (u) { deny("network call to " + hostOf(u)); });
  stub("XMLHttpRequest", function () { deny("XMLHttpRequest"); });
  stub("WebSocket", function (u) { deny("WebSocket to " + hostOf(u)); });
  stub("EventSource", function (u) { deny("EventSource to " + hostOf(u)); });
  stub("require", function (name) { deny("require" + "(" + String(name).slice(0, 60) + ")"); });
  stub("Worker", function () { deny("Worker"); });
  var told = {};
  var getter = function (name) { Object.defineProperty(g, name, { get: function () { if (told[name]) throw new Error(name + " is not available in a Kit script."); told[name] = true; deny(name); }, configurable: false, enumerable: false }); };
  getter("process"); getter("module");
  var api = {
    call: function (cap, input) {
      return new Promise(function (resolve, reject) {
        var json;
        try { json = JSON.stringify(input === undefined ? null : input); } catch (e) { reject(new Error("api.call input must be JSON.")); return; }
        if (typeof json !== "string") { reject(new Error("api.call input must be JSON.")); return; }
        hostCall(String(cap), json).then(function (answer) {
          var r = JSON.parse(answer);
          if (r.ok) resolve(JSON.parse(r.value)); else reject(new Error(String(r.error)));
        }, function () { reject(new Error("api.call failed.")); });
      });
    }
  };
  Object.freeze(api.call); Object.freeze(api);
  return api;
})`;

function wrap(source: string): string {
  return `(async function (__input, api) {
"use strict";
var input = JSON.parse(__input);
var __result = await (async function () {
${source}
})();
return JSON.stringify(__result === undefined ? null : __result);
})`;
}

interface WorkerData {
  kitSandbox: true;
  source: string;
  inputJson: string;
  cpuMs: number;
  maxResultBytes: number;
}

async function workerMain(): Promise<void> {
  const port = parentPort;
  if (!port) return;
  const data = workerData as WorkerData;
  const pending = new Map<number, (answer: string) => void>();
  let seq = 0;
  port.on("message", (m: { type: string; id: number; answer: string }) => {
    if (m.type === "answer") pending.get(m.id)?.(m.answer);
  });
  const hostCall = (cap: string, inputJson: string): Promise<string> =>
    new Promise<string>((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      port.postMessage({ type: "call", id, cap, input: inputJson });
    });
  const hostDeny = (what: string): void => {
    port.postMessage({ type: "deny", what: String(what).slice(0, 200) });
  };
  try {
    const context = vm.createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } });
    const api = new vm.Script(BOOTSTRAP, { filename: "kit-bootstrap" }).runInContext(context)(hostCall, hostDeny) as unknown;
    const fn = new vm.Script(wrap(data.source), { filename: "kit-script" }).runInContext(context, { timeout: data.cpuMs }) as (input: string, api: unknown) => unknown;
    // the synchronous part of the script runs inside a timed vm call; later turns of the event loop are cut by the main thread's wall clock
    Object.defineProperty(context, "__run", { value: fn, enumerable: false, configurable: true });
    Object.defineProperty(context, "__in", { value: data.inputJson, enumerable: false, configurable: true });
    Object.defineProperty(context, "__api", { value: api, enumerable: false, configurable: true });
    const started = new vm.Script("__run(__in, __api)", { filename: "kit-run" }).runInContext(context, { timeout: data.cpuMs }) as Promise<unknown>;
    const out = await started;
    const text = typeof out === "string" ? out : "null";
    if (text.length > data.maxResultBytes) {
      port.postMessage({ type: "done", ok: false, error: "The script returned more than 1 MB." });
      return;
    }
    port.postMessage({ type: "done", ok: true, json: text });
  } catch (e) {
    const raw = e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e);
    port.postMessage({ type: "done", ok: false, error: raw.slice(0, 300) });
  }
}

if (!isMainThread && (workerData as { kitSandbox?: boolean } | null)?.kitSandbox === true) void workerMain();

// ---- the main thread -------------------------------------------------------------------------------------------

/** Dynamic import( and import.meta cannot be sandboxed from a string, so a script that uses them is refused. */
export const DYNAMIC_IMPORT = "dynamic imp" + "ort()"; // spelled in two parts: scripts/boundaries.ts reads any literal call of that name in a file as an import
export function staticDenial(source: string): string | null {
  if (/\bimport\s*\(/.test(source)) return DYNAMIC_IMPORT;
  if (/\bimport\s*\.\s*meta\b/.test(source)) return "import.meta";
  return null;
}

export function runSandboxed(o: SandboxOptions): Promise<SandboxResult> {
  const cpuMs = o.cpuMs ?? DEFAULTS.cpuMs;
  const wallMs = o.wallMs ?? DEFAULTS.wallMs;
  const maxCalls = o.maxCalls ?? DEFAULTS.maxCalls;
  const maxSource = o.maxSourceBytes ?? DEFAULTS.maxSourceBytes;
  const t0 = performance.now();
  const denials: string[] = [];
  let calls = 0;

  const early = (error: string, denial?: string): Promise<SandboxResult> => {
    if (denial) denials.push(denial);
    return Promise.resolve({ ok: false, error, denials, calls, ms: Math.round(performance.now() - t0) });
  };
  if (o.source.length > maxSource) return early(`The script is longer than ${maxSource} characters.`);
  const blocked = staticDenial(o.source);
  if (blocked) return early(`${blocked} is not available in a Kit script.`, blocked);
  let inputJson: string;
  try {
    inputJson = JSON.stringify(o.input === undefined ? null : o.input);
  } catch {
    return early("The script input is not JSON.");
  }

  return new Promise<SandboxResult>((resolve) => {
    let done = false;
    const data: WorkerData = { kitSandbox: true, source: o.source, inputJson, cpuMs, maxResultBytes: DEFAULTS.maxResultBytes };
    const worker = new Worker(new URL(import.meta.url), {
      workerData: data, env: {}, stdout: true, stderr: true, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: DEFAULTS.memoryMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 2 },
    });
    const finish = (r: { ok: boolean; value?: unknown; error?: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...r, denials, calls, ms: Math.round(performance.now() - t0) });
    };
    const timer = setTimeout(() => finish({ ok: false, error: `The script ran longer than ${wallMs} ms and was stopped.` }), wallMs);

    const answer = (id: number, body: { ok: true; value: string } | { ok: false; error: string }): void => {
      if (!done) worker.postMessage({ type: "answer", id, answer: JSON.stringify(body) });
    };

    worker.on("message", (m: { type: string; id?: number; cap?: string; input?: string; what?: string; ok?: boolean; json?: string; error?: string }) => {
      if (m.type === "deny" && typeof m.what === "string") {
        denials.push(m.what);
      } else if (m.type === "call" && typeof m.id === "number" && typeof m.cap === "string" && typeof m.input === "string") {
        const id = m.id, cap = m.cap;
        calls += 1;
        if (calls > maxCalls) {
          denials.push(`api.call limit of ${maxCalls} reached`);
          answer(id, { ok: false, error: `A script may make at most ${maxCalls} calls.` });
          return;
        }
        if (!o.caps.includes(cap)) {
          denials.push(`api.call ${cap.slice(0, 80)}`);
          answer(id, { ok: false, error: `${cap.slice(0, 80)} is not one of the tools this Kit declared.` });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(m.input);
        } catch {
          answer(id, { ok: false, error: "api.call input must be JSON." });
          return;
        }
        o.call(cap, parsed).then(
          (value) => answer(id, { ok: true, value: JSON.stringify(value === undefined ? null : value) }),
          (e: unknown) => {
            const code = (e as { error?: { code?: unknown } } | null)?.error?.code;
            if (typeof code === "string" && code.startsWith("permission.")) denials.push(`api.call ${cap.slice(0, 80)} (${code})`);
            const msg = (e as { error?: { message?: unknown } } | null)?.error?.message ?? (e instanceof Error ? e.message : "The call failed.");
            answer(id, { ok: false, error: String(msg).slice(0, 300) });
          },
        );
      } else if (m.type === "done") {
        if (m.ok === true && typeof m.json === "string") {
          try {
            finish({ ok: true, value: JSON.parse(m.json) });
          } catch {
            finish({ ok: false, error: "The script returned something that is not JSON." });
          }
        } else finish({ ok: false, error: m.error ?? "The script failed." });
      }
    });
    worker.on("error", (e) => finish({ ok: false, error: /heap|memory/i.test(e.message) ? "The script used more memory than allowed." : e.message.slice(0, 300) }));
    worker.on("exit", () => finish({ ok: false, error: "The script stopped unexpectedly." }));
  });
}
