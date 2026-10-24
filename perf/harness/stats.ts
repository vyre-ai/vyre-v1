// Median of 5 and p95. With 5 samples, p95 is the largest (nearest rank). No ratchet.

/** Fast lane sample count. A run fails when p95 exceeds the budget by any amount. */
export const SAMPLE_COUNT = 5;

export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error("no samples");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Nearest-rank percentile. p is 0 to 100. p95 of 5 samples is the max. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) throw new Error("no samples");
  if (!(p >= 0 && p <= 100)) throw new Error("percentile is 0 to 100");
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  const i = Math.min(s.length, Math.max(1, rank)) - 1;
  return s[i]!;
}
