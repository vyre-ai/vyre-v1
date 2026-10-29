// Timing samples a device measured itself (app start to usable, Cmd-K, opening a tab...) and uploads with its log: each becomes a span named by its performance budget id, which is exactly what
// console.speed rolls up. A sample for a name that is not a budget is dropped, a value that is not a finite number of at least zero is dropped, and at most MAX_SAMPLES are taken per upload.

export const MAX_SAMPLES = 100;
/** The budget ids a device can measure and their units (perf/budgets.json; modules/logs/tests/samples.test.ts keeps this list equal to it). ms samples ride in the span's duration, the others in attrs.value. */
export const BUDGET_UNITS: Readonly<Record<string, "ms" | "cls" | "percent" | "count">> = {
  startup: "ms", navigate: "ms", search: "ms", chat_open: "ms", send: "ms", scroll: "ms", space_switch: "ms", edit: "ms", table100k: "ms", sync_snapshot: "ms", authz: "ms", server_write: "ms",
  engine_pool: "ms", stream_render: "ms", layout_shift: "cls", prefetch: "percent", connection_count: "count", console_speed: "ms",
};

export interface Sample { budgetId: string; value: number; at: number; traceId?: string | undefined; attrs?: Record<string, unknown> | undefined }

const hex = (bytes: number): string => [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The span line for one sample, or null when it is not one a device may send. */
export function spanOf(s: Sample, device: string, now: number): Record<string, unknown> | null {
  const unit = BUDGET_UNITS[s.budgetId];
  if (!unit || typeof s.value !== "number" || !Number.isFinite(s.value) || s.value < 0 || s.value > 3_600_000) return null;
  const at = Number.isFinite(s.at) ? Math.min(s.at, now) : now;
  return {
    traceId: s.traceId ?? hex(16), spanId: hex(8), name: s.budgetId, at,
    ...(unit === "ms" ? { durUs: Math.round(s.value * 1000) } : {}),
    attrs: { ...(s.attrs ?? {}), measured: s.value, source: "device", device },
  };
}
