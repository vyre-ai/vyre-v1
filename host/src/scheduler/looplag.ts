// Event-loop lag (rc.22 perf): a timer that should fire every SAMPLE_MS and says how late it was. A job step that holds the single event loop shows up as lag on the
// next sample. Any lag over WARN_MS is warned with the jobs that were running; the largest lag since the last read goes into the machines report and the doctor.
export const SAMPLE_MS = 50;
export const WARN_MS = 200;

export interface LoopLag {
  /** the largest lag in ms since the last call, and the 99th percentile of the samples since then */
  take(): { maxMs: number; p99Ms: number };
  stop(): void;
}

/** Start sampling. `running` names the jobs in flight when a block is seen; `warn` gets one line per block over WARN_MS. */
export function startLoopLag(o: { running?: () => string[]; warn?: (msg: string, attrs: Record<string, unknown>) => void; now?: () => number } = {}): LoopLag {
  const now = o.now ?? (() => performance.now());
  let last = now(), samples: number[] = [];
  const t = setInterval(() => {
    const at = now(), lag = Math.max(0, at - last - SAMPLE_MS);
    last = at;
    if (samples.length < 4096) samples.push(lag);
    if (lag > WARN_MS) o.warn?.("scheduler.loop_blocked", { lagMs: Math.round(lag), jobs: o.running?.() ?? [] });
  }, SAMPLE_MS);
  t.unref();
  return {
    take() {
      // a block still unreported (the timer has not got its turn since) counts too
      const pending = Math.max(0, now() - last - SAMPLE_MS);
      if (pending > 0) samples.push(pending);
      const s = samples.sort((a, b) => a - b);
      samples = [];
      return { maxMs: Math.round(s[s.length - 1] ?? 0), p99Ms: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.99))] ?? 0) };
    },
    stop() { clearInterval(t); },
  };
}

let shared: LoopLag | null = null;
/** The daemon's one sampler. */
export function loopLag(o?: Parameters<typeof startLoopLag>[0]): LoopLag {
  shared ??= startLoopLag(o);
  return shared;
}
