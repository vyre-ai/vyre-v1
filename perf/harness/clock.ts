// Fake UI clock. Perf samples advance it by hand so a span's timestamps do not depend on wall time.

export interface FakeClock {
  now(): number;
  advance(ms: number): number;
}

export function createClock(start = 0): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError("a clock only moves forward");
      t += ms;
      return t;
    },
  };
}
