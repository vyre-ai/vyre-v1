// Shared shapes for the perf harness (ARCH 9).

export type Sense = "max" | "min" | "exact";

export interface AlsoLimit {
  metric: string;
  p95: number;
  machine?: string;
  sense?: Sense;
}

/** One acceptance row. `probe` is an id in the probe catalog. */
export interface Budget {
  id: string;
  metric: string;
  p50: number;
  p95: number;
  machine: string;
  probe: string;
  unit: string;
  sense: Sense;
  also?: AlsoLimit[];
}

/** A row of perf/generated/probes.json, or of generated/probes.json when that is what tools/gen wrote. */
export interface Probe {
  id: string;
  screen?: string;
  place?: string;
  firstPaintMs?: number;
  completeMs?: number;
  files?: string[];
}

export interface Span {
  id: string;
  name: string;
  budgetId: string;
  traceId: string;
  parentId: string | null;
  startMs: number;
  endMs: number;
}

/** One run. `spans` are the trace for this sample, printed when the row fails. */
export interface Sample {
  value: number;
  traceId: string;
  spans: Span[];
}

export interface RunReport {
  id: string;
  metric: string;
  machine: string;
  unit: string;
  samples: number[];
  p50: number;
  p95: number;
  budgetP50: number;
  budgetP95: number;
  ok: boolean;
  worstTraceId: string;
  waterfall?: string;
}

/** console.speed output: spans rolled up per budget id. */
export interface SpeedRow {
  budgetId: string;
  p50: number;
  p95: number;
  budgetP95: number;
  over: boolean;
  worstTraceId?: string;
}
