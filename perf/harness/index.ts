// Perf harness entry (ARCH 9): budgets, probes, headless client, median of 5, waterfall on failure.

export { BUDGETS_FILE, loadBudgets } from "./budgets.ts";
export { createFakeUiClock } from "./clock.ts";
export type { UiClock } from "./clock.ts";
export { createHeadlessClient } from "./headless.ts";
export type { HeadlessClient, OpenSpan } from "./headless.ts";
export {
  PROBES_OUT,
  REPO_ROOT,
  SCREEN_PROBES,
  affectedProbeIds,
  budgetProbeCatalog,
  fileHits,
  isFullLane,
  mergeProbes,
  readProbeIndex,
  readScreenProbes,
  refreshProbes,
  selectRows,
} from "./probes.ts";
export { fixtureSpans, measureConsoleSpeed, rollup } from "./rollup.ts";
export { builtinMeasure, compareRun, failureText, printFailures, reportJson, runLane, takeSamples } from "./run.ts";
export type { LaneReport } from "./run.ts";
export { SAMPLE_COUNT, median, percentile } from "./stats.ts";
export type { Budget, CompareResult, Lane, Machine, Probe, RowReport, SampleResult, Span, SpeedRow } from "./types.ts";
export { formatWaterfall } from "./waterfall.ts";
