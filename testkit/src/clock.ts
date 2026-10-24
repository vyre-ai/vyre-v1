// A fake clock. Schedulers and waits in tests read this instead of Date.now, and a test moves it by hand.
export interface FakeClock {
  now(): number;
  advance(ms: number): number;
  set(ms: number): void;
}
export const CLOCK_START = 1_760_000_000_000;
export function createClock(start: number = CLOCK_START): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance(ms) { if (!(ms >= 0)) throw new RangeError("a clock only moves forward"); t += ms; return t; },
    set(ms) { t = ms; },
  };
}
