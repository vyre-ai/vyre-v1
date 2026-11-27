// Where the start of the server spends its time (27 Nov 2026): the person waits for it on every update. Phases are marked in order as the start passes them; each is the time since the one before. The
// report is one line, written when the server listens (main.ts), so a slow start names its slow part without a profiler. Marking costs one clock read.
const marks: [string, number][] = [];
let last = performance.now();
let first = last;

/** The start of this process's own work: time before it (node starting and importing the daemon's modules) is what performance.now() already counts. */
export function bootBegin(): void {
  first = last = performance.now();
  marks.length = 0;
}
/** Phase `name` ended now. */
export function bootMark(name: string): void {
  const at = performance.now();
  marks.push([name, at - last]);
  last = at;
}
/** One line: how long from the process start to now, how much of it was importing, and each phase in order. */
export function bootReport(): string {
  const now = performance.now();
  const total = Math.round(now);
  const phases = [...marks, ["after listen", now - last] as [string, number]].map(([n, ms]) => `${n} ${Math.round(ms)}`).join(", ");
  return `boot ${total} ms: imports ${Math.round(first)}, ${phases}`;
}
/** The phases, longest first (tests, and the console's doctor). */
export const bootPhases = (): { name: string; ms: number }[] =>
  marks.map(([name, ms]) => ({ name, ms: Math.round(ms) })).sort((a, b) => b.ms - a.ms);
