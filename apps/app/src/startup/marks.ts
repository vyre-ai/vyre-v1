// app.start and app.usable as User Timing marks. The perf probe (Playwright) reads them with performance.getEntriesByName.
export function mark(name: "app.start" | "app.usable"): void {
  const p = (globalThis as { performance?: { mark?: (n: string) => unknown } }).performance;
  p?.mark?.(name);
  // the boot script registers the service worker on this (startup/boot.ts)
  const w = globalThis as { dispatchEvent?: (e: unknown) => boolean; Event?: new (type: string) => unknown };
  if (name === "app.usable" && w.dispatchEvent && w.Event) w.dispatchEvent(new w.Event("vyre:usable"));
}

/** Milliseconds from app.start to app.usable, or null if either mark is missing. */
export function startupMs(entries: readonly { name: string; startTime: number }[]): number | null {
  const a = entries.find((e) => e.name === "app.start");
  const b = entries.find((e) => e.name === "app.usable");
  return a && b ? b.startTime - a.startTime : null;
}
