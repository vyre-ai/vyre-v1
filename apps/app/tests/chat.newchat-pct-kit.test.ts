// The nearest-rank percentile every new chat budget walk reports by (no test of its own: a kit).
export const pct = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.max(0, Math.ceil(p * s.length) - 1)]!);
};
