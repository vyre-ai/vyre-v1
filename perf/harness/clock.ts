// Fake UI clock for the headless client. Time moves only when the test advances it.

export interface UiClock {
  now(): number;
  advance(ms: number): void;
}

export function createFakeUiClock(start = 0): UiClock {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      if (!(ms >= 0) || !Number.isFinite(ms)) throw new Error("clock only moves forward");
      t += ms;
    },
  };
}
