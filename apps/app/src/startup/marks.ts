// app.start and app.usable as User Timing marks. The perf probe (Playwright) reads them with performance.getEntriesByName.
export function mark(name: "app.start" | "app.usable"): void {
  const p = (globalThis as { performance?: { mark?: (n: string) => unknown } }).performance;
  p?.mark?.(name);
}

/** Milliseconds from app.start to app.usable, or null if either mark is missing. */
export function startupMs(entries: readonly { name: string; startTime: number }[]): number | null {
  const a = entries.find((e) => e.name === "app.start");
  const b = entries.find((e) => e.name === "app.usable");
  return a && b ? b.startTime - a.startTime : null;
}

let startupSent = false;
/** Once per page load: the time from app.start to the first usable screen, for the Speed page. Null while either mark is missing or after it was taken. */
export function takeStartupMs(entries: readonly { name: string; startTime: number }[]): number | null {
  if (startupSent) return null;
  const ms = startupMs(entries);
  if (ms === null || ms < 0) return null;
  startupSent = true;
  return ms;
}
export function resetStartupForTests(): void { startupSent = false; }
