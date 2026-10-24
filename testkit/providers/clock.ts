// Clocks for fake providers. Latency is a sleep on the clock, so a test can inject 200 ms
// on the wall clock or advance a manual clock without a real wait (ARCH 9, no wall-clock sleeps in perf).

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const wallClock: Clock = {
  now: () => Date.now(),
  // Loop until the deadline. A single timer can fire early; the provider latency must not.
  sleep: async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const left = end - Date.now();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, left);
      });
    }
  },
};

export function manualClock(start = 0): Clock & { advance(ms: number): void } {
  let now = start;
  const pending: { at: number; resolve: () => void }[] = [];
  return {
    now: () => now,
    sleep(ms: number) {
      if (ms <= 0) return Promise.resolve();
      const at = now + ms;
      return new Promise((resolve) => {
        pending.push({ at, resolve });
      });
    },
    advance(ms: number) {
      now += ms;
      for (let i = pending.length - 1; i >= 0; i--) {
        const w = pending[i];
        if (w && w.at <= now) {
          pending.splice(i, 1);
          w.resolve();
        }
      }
    },
  };
}
