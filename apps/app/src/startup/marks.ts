// app.start and app.usable as User Timing marks. The perf probe (Playwright) reads them with performance.getEntriesByName.
export function mark(name: "app.start" | "app.usable"): void {
  const p = (globalThis as { performance?: { mark?: (n: string) => unknown } }).performance;
  p?.mark?.(name);
  // the boot script registers the service worker on this (startup/boot.ts)
  const w = globalThis as { dispatchEvent?: (e: unknown) => boolean; Event?: new (type: string) => unknown };
  if (name === "app.usable" && w.dispatchEvent && w.Event) w.dispatchEvent(new w.Event("vyre:usable"));
}

/** Resolves when the app is usable, or after `limit` ms: a slow place does not hold the first frame up for ever, it shows its own loading frame. */
export function whenUsable(limit = 8000): Promise<void> {
  const w = globalThis as unknown as { performance?: { getEntriesByName?(n: string): unknown[] }; addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void };
  if ((w.performance?.getEntriesByName?.("app.usable").length ?? 0) > 0 || !w.addEventListener) return Promise.resolve();
  return new Promise((done) => {
    const finish = (): void => { clearTimeout(t); w.removeEventListener?.("vyre:usable", finish); done(); };
    const t = setTimeout(finish, limit);
    w.addEventListener?.("vyre:usable", finish);
  });
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
