// What it does not do: it opens no inspector port and no socket (the session is in-process, worker to main thread: `inspector.url()` stays undefined), it asks for call frames only (function, file, line;
// never scopes, locals or arguments, so no secret that a variable holds), it writes at most one line per stall and MAX_PER_MINUTE a minute, and when the loop is healthy it does nothing but a heartbeat store.
// A stall that names itself (rc.40). The loop-lag sampler says how long the event loop was blocked and which jobs were running; it cannot say what code held it. This is a watchdog on its own
// thread: the loop writes a heartbeat every HEART_MS; when the beat is older than STALL_MS the watchdog asks the blocked thread (through the inspector) to pause at the next point it can,
// reads the call stack there, lets it carry on, and writes one line with the stack straight to stderr (the loop that would log it is the one that is blocked). Costs one idle thread and a
// timer; the inspector is attached only while a stall is being looked at.
import { Worker } from "node:worker_threads";

export const HEART_MS = 100;
export const STALL_MS = 500;
/** At most this many stall lines a minute: a loop that stalls over and over says so a few times, not forever. */
export const MAX_PER_MINUTE = 6;

const WATCHDOG = `
const { workerData } = require("node:worker_threads");
const { Session } = require("node:inspector");
const fs = require("node:fs");
const beat = new BigInt64Array(workerData.beat);
const stallMs = workerData.stallMs;
let inStall = false;
let busy = false;
const stamps = [];
const maxPerMinute = workerData.maxPerMinute;
setInterval(() => {
  const last = Number(Atomics.load(beat, 0));
  if (!last || busy) return;
  const late = Date.now() - last;
  if (late < stallMs) { inStall = false; return; }
  if (inStall) return; // one line per stall
  inStall = true;
  const nowT = Date.now();
  while (stamps.length && nowT - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= maxPerMinute) return;
  stamps.push(nowT);
  busy = true;
  const s = new Session();
  const done = (frames, why) => {
    try { s.disconnect(); } catch {}
    busy = false;
    try { fs.writeSync(2, JSON.stringify({ level: "warn", msg: "scheduler.loop_stalled", lateMs: Date.now() - last, stack: frames, ...(why ? { why } : {}) }) + "\\n"); } catch {}
  };
  try {
    s.connectToMainThread();
    s.on("Debugger.paused", (m) => {
      const frames = (m.params.callFrames || []).slice(0, 12).map((f) => (f.functionName || "(anonymous)") + " " + String(f.url || "").split("/").slice(-3).join("/") + ":" + (f.location.lineNumber + 1));
      s.post("Debugger.resume", () => done(frames));
    });
    s.post("Debugger.enable", () => s.post("Debugger.pause"));
    setTimeout(() => { if (busy) done([], "no stop point reached in 3 s (blocked in native code)"); }, 3000).unref();
  } catch (e) { done([], String(e && e.message || e)); }
}, ${HEART_MS});
`;

export interface StallWatch {
  stop(): void;
}

/** Start the watchdog (the loop's heartbeat and the thread). Returns a handle to stop both; a platform without worker threads gets a no-op. */
export function startStallWatch(o: { stallMs?: number; maxPerMinute?: number } = {}): StallWatch {
  try {
    const shared = new SharedArrayBuffer(8);
    const beat = new BigInt64Array(shared);
    Atomics.store(beat, 0, BigInt(Date.now()));
    const t = setInterval(() => Atomics.store(beat, 0, BigInt(Date.now())), HEART_MS);
    t.unref();
    const w = new Worker(WATCHDOG, {
      eval: true,
      workerData: { beat: shared, stallMs: o.stallMs ?? STALL_MS, maxPerMinute: o.maxPerMinute ?? MAX_PER_MINUTE },
    });
    w.unref();
    w.on("error", () => undefined);
    return {
      stop() {
        clearInterval(t);
        void w.terminate();
      },
    };
  } catch {
    return { stop() {} };
  }
}
