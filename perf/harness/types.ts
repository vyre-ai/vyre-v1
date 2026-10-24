// Perf harness types (ARCH 9). One budget row is id, metric, p50, p95, machine.

export type Machine = "mid laptop" | "mid phone";
export type Lane = "fast" | "full";

export interface Budget {
  id: string;
  metric: string;
  p50: number;
  p95: number;
  machine: Machine;
}

/** A probe id the fast lane can map to changed files. Screen probes come from generated/probes.json. */
export interface Probe {
  id: string;
  screen?: string;
  place?: string;
  firstPaintMs?: number;
  completeMs?: number;
  spans?: string[];
  files?: string[];
}

export interface Span {
  id: string;
  name: string;
  budgetId: string;
  startMs: number;
  durMs: number;
  traceId: string;
  parentId?: string;
}

export interface SampleResult {
  value: number;
  spans: Span[];
  traceId: string;
}

/** console.speed row: spans rolled up per budget id. */
export interface SpeedRow {
  budgetId: string;
  p50: number;
  p95: number;
  budgetP95: number;
  worstTraceId: string | null;
  over: boolean;
}

export interface RowReport {
  id: string;
  metric: string;
  machine: Machine;
  p50: number;
  p95: number;
  budgetP50: number;
  budgetP95: number;
  ok: boolean;
  samples: number[];
}

export interface CompareResult extends RowReport {
  waterfall: string;
}
