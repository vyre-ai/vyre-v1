// Fast lane (ARCH 9): the rows whose probe ids the change touches, looked up in probes.json.
// The full set runs on main and tags. A harness or catalog change runs every row.

import type { Budget, Probe } from "./types.ts";

const ALL_FILES = new Set([
  "perf/budgets.json",
  "perf/generated/probes.json",
  "generated/probes.json",
  "generated/screens.ts",
]);

function needles(probe: Probe): string[] {
  const out = [probe.id];
  if (probe.screen) {
    out.push(probe.screen.replaceAll(".", "/"));
    out.push(probe.screen.replaceAll(".", "-"));
  }
  if (probe.files) out.push(...probe.files);
  return out.filter((key) => key.length > 0);
}

function probeHit(probe: Probe, changed: readonly string[]): boolean {
  const keys = needles(probe);
  return changed.some((file) => keys.some((key) => file.includes(key)));
}

function runAll(changed: readonly string[]): boolean {
  return changed.some((file) => ALL_FILES.has(file) || file.startsWith("perf/harness/"));
}

/**
 * `full` returns every row. `fast` returns the rows whose probe the changed paths touch.
 * Paths are repo-relative. A screen id `console.speed` matches `ui/src/console/speed.tsx`.
 */
export function rowsForLane(lane: "fast" | "full", changed: readonly string[], budgets: readonly Budget[], probes: readonly Probe[]): Budget[] {
  if (lane === "full" || runAll(changed)) return [...budgets];
  const hit = new Set(probes.filter((probe) => probeHit(probe, changed)).map((probe) => probe.id));
  return budgets.filter((budget) => hit.has(budget.probe));
}
