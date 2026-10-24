// Small helpers for the turn-engine tests: a manual gate, a poll-until, a manual clock. No assertions here.
export interface Gate { readonly wait: Promise<void>; open(): void }

export function gate(): Gate {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open: () => open() };
}

/** Resolve once `cond()` is true, checking after each macrotask. Fails after `limit` checks so a broken test cannot hang. */
export async function until(cond: () => boolean, limit = 2000): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (cond()) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw new Error("until: condition never became true");
}

export interface ManualClock { now(): number; advance(ms: number): void }
export function manualClock(start = 1_760_000_000_000): ManualClock {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
