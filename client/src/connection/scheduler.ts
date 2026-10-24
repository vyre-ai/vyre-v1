// Time for the connection manager, behind a port so heartbeat and backoff tests run without waiting (ARCH 5.9: heartbeat every 15 s, 40 s of silence marks an endpoint unhealthy).
export interface Scheduler {
  now(): number;
  /** Call `fn` every `ms`. Returns a cancel function. */
  every(ms: number, fn: () => void): () => void;
  /** Call `fn` once after `ms`. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  every(ms, fn) { const h = setInterval(fn, ms); return () => clearInterval(h); },
  after(ms, fn) { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
};

export interface ManualScheduler extends Scheduler {
  /** Move the clock forward, running every timer that falls due, in time order. */
  advance(ms: number): void;
  /** Timers waiting. */
  pending(): number;
}

/** A clock the test moves by hand. Timers run inside `advance`, oldest first; one that schedules another inside the window runs it too. */
export function manualScheduler(start = 0): ManualScheduler {
  let t = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; every: number | null; fn: () => void }>();
  const add = (ms: number, every: number | null, fn: () => void): (() => void) => {
    const id = nextId++;
    timers.set(id, { at: t + ms, every, fn });
    return () => { timers.delete(id); };
  };
  return {
    now: () => t,
    every: (ms, fn) => add(ms, ms, fn),
    after: (ms, fn) => add(ms, null, fn),
    pending: () => timers.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let best: [number, { at: number; every: number | null; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
        if (!best) break;
        const [id, tm] = best;
        t = Math.max(t, tm.at);
        if (tm.every === null) timers.delete(id); else tm.at += tm.every;
        tm.fn();
      }
      t = end;
    },
  };
}
