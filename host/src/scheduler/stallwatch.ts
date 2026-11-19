// What it does not do: it opens no inspector port and no socket (the session is in-process, worker to main thread: `inspector.url()` stays undefined), it asks for call frames only (function, file, line;
// never scopes, locals or arguments, so no secret that a variable holds), it hands the caller's log at most one line per stall and MAX_PER_MINUTE a minute (it never writes to stderr or a file itself), and when the loop is healthy it does nothing but a heartbeat store.
// A stall that names itself (rc.40). The loop-lag sampler says how long the event loop was blocked and which jobs were running; it cannot say what code held it. This is a watchdog on its own
// thread: the loop writes a heartbeat every HEART_MS; when the beat is older than STALL_MS the watchdog asks the blocked thread (through the inspector) to pause at the next point it can,
// reads the call stack there, lets it carry on, and posts one message with the stack to the main thread; the caller's log gets it as soon as the loop runs again. Costs one idle thread and a
// timer; the inspector is attached only while a stall is being looked at.
import { Worker } from "node:worker_threads";

export const HEART_MS = 100;
export const STALL_MS = 500;
/** At most this many stall lines a minute: a loop that stalls over and over says so a few times, not forever. */
export const MAX_PER_MINUTE = 6;

const WATCHDOG = `
const { workerData } = require("node:worker_threads");
const { Session } = require("node:inspector");
const { parentPort } = require("node:worker_threads");
const beat = new BigInt64Array(workerData.beat);
const stallMs = workerData.stallMs;
const mono = () => Number(process.hrtime.bigint() / 1000000n);
let inStall = false;
let busy = false;
let lastTick = mono();
let lastWall = Date.now();
let forgiveAt = 0;
const stamps = [];
const maxPerMinute = workerData.maxPerMinute;
setInterval(() => {
  const m = mono();
  const w = Date.now();
  const gap = m - lastTick;
  const wallGap = w - lastWall;
  lastTick = m;
  lastWall = w;
  // this thread itself was held back, or the clock on the wall moved differently from the steady one: the whole process was paused (a machine that slept, a container that was stopped), not the loop; what the
  // loop's heartbeat missed meanwhile is forgiven
  if (gap > stallMs + 200 || Math.abs(wallGap - gap) > 1000) { forgiveAt = m; inStall = false; return; }
  const last = Math.max(Number(Atomics.load(beat, 0)), forgiveAt);
  if (!last || busy) return;
  const late = m - last;
  if (late < stallMs) { inStall = false; return; }
  if (inStall) return; // one line per stall
  inStall = true;
  const nowT = m;
  while (stamps.length && nowT - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= maxPerMinute) return;
  stamps.push(nowT);
  busy = true;
  const s = new Session();
  const done = (frames, why) => {
    try { s.disconnect(); } catch {}
    busy = false;
    try { parentPort.postMessage({ lateMs: mono() - last, stack: frames, ...(why ? { why } : {}) }); } catch {}
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

const mono = (): bigint => process.hrtime.bigint() / 1000000n;

export interface StallWatch {
  /** Ends the heartbeat and the thread; resolves when the thread is gone. */
  stop(): Promise<void>;
}

/** Start the watchdog (the loop's heartbeat and the thread). Returns a handle to stop both; a platform without worker threads gets a no-op. */
export function startStallWatch(
  o: {
    stallMs?: number;
    maxPerMinute?: number;
    log?: (stall: { lateMs: number; stack: string[]; why?: string }) => void;
  } = {},
): StallWatch {
  try {
    const shared = new SharedArrayBuffer(8);
    const beat = new BigInt64Array(shared);
    Atomics.store(beat, 0, mono());
    const t = setInterval(() => Atomics.store(beat, 0, mono()), HEART_MS);
    t.unref();
    const w = new Worker(WATCHDOG, {
      eval: true,
      workerData: { beat: shared, stallMs: o.stallMs ?? STALL_MS, maxPerMinute: o.maxPerMinute ?? MAX_PER_MINUTE },
    });
    w.unref();
    w.on("error", () => undefined);
    // the line is handed to the caller's own log once the loop runs again (the thread cannot write while the loop is held, and it never writes to stderr itself)
    w.on("message", (m: { lateMs: number; stack: string[]; why?: string }) => {
      try {
        o.log?.(m);
      } catch {
        /* a log that throws costs nothing */
      }
    });
    return {
      async stop() {
        clearInterval(t);
        await w.terminate();
      },
    };
  } catch {
    return { stop: async () => undefined };
  }
}
