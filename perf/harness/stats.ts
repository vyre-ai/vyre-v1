// Median of 5 and the p95 the fast lane compares to budgets.json. No ratchet.

/** Samples the harness takes before it compares a row. */
export const SAMPLE_COUNT = 5;

export interface Summary {
  p50: number;
  p95: number;
  min: number;
  max: number;
}

function sorted(samples: readonly number[]): number[] {
  if (samples.length === 0) throw new Error("no samples");
  return [...samples].sort((a, b) => a - b);
}

/** Nearest-rank percentile. `p` is 0 to 1. p95 of 5 samples is the slowest sample. */
export function percentile(samples: readonly number[], p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError("percentile p must be between 0 and 1");
  const s = sorted(samples);
  const rank = Math.ceil(p * s.length);
  const index = Math.min(s.length - 1, Math.max(0, rank - 1));
  const value = s[index];
  if (value === undefined) throw new Error("no samples");
  return value;
}

/** Middle sample, or the mean of the two middle samples when the count is even. */
export function median(samples: readonly number[]): number {
  const s = sorted(samples);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid];
  if (hi === undefined) throw new Error("no samples");
  if (s.length % 2 === 1) return hi;
  const lo = s[mid - 1];
  if (lo === undefined) throw new Error("no samples");
  return (lo + hi) / 2;
}

/** p50 is the median. p95 fails the fast lane when it is over the budget by any amount. */
export function summarize(samples: readonly number[]): Summary {
  return { p50: median(samples), p95: percentile(samples, 0.95), min: Math.min(...samples), max: Math.max(...samples) };
}
