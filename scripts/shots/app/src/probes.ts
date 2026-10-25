// Mount side of the browser probes (ruling 43). A mount records what it measured on window.__probes; scripts/shots/probes/browser.mjs reads it
// after a fresh mount, discards the warm-up and judges the median of five against perf/budgets.json.
type Kind = "startup" | "navigate" | "scroll" | "space_switch" | "layout_shift" | "prefetch" | "chat_open";
type Probes = Partial<Record<Kind, number>> & { ready?: boolean };

const store = (): Probes => {
  const w = globalThis as unknown as { __probes?: Probes };
  return (w.__probes ??= {});
};

/** Records one measurement (ms, score or percent, per the budget's unit). */
export function setProbe(kind: Kind, value: number): void {
  store()[kind] = value;
}

/** Marks the object complete so the runner stops waiting for kinds this mount will not write. */
export function probesReady(): void {
  store().ready = true;
}

/** Milliseconds from navigation start to now (the open time of the screen the mount shows). */
export function sinceNavigation(): number {
  return performance.now();
}

/** Sums layout-shift entries not caused by input into probes.layout_shift until the returned stop function runs. */
export function watchLayoutShift(): () => void {
  setProbe("layout_shift", 0);
  if (typeof PerformanceObserver !== "function") return () => {};
  const po = new PerformanceObserver((list) => {
    let sum = store().layout_shift ?? 0;
    for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) sum += e.value;
    setProbe("layout_shift", sum);
  });
  try { po.observe({ type: "layout-shift", buffered: true }); } catch { return () => {}; }
  return () => po.disconnect();
}
