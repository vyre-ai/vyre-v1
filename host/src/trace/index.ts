// Trace propagation (ARCH 4.9). traceId is 16 random bytes in hex, spanId 8. Header `x-vyre-trace: <traceId>-<spanId>[-<parentSpanId>]`; WebSocket frames carry `tr` with the same text.
// Every layer opens a span with `tracer.span(name, fn)`; a span is a row in logs.db `spans`. Child spans inherit the trace id and name the enclosing span as parent.
import type { TraceContext } from "../../../packages/contracts/src/types.ts";

const TRACE = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-([0-9a-f]{16}))?$/;

export interface TraceParts { traceId: string; spanId: string; parent?: string }
const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export const newTraceId = (): string => hex(16);
export const newSpanId = (): string => hex(8);

/** `<traceId>-<spanId>[-<parent>]`, or undefined when the text is not one. */
export function parseTr(text: unknown): TraceParts | undefined {
  const m = typeof text === "string" ? TRACE.exec(text) : null;
  return m ? { traceId: m[1]!, spanId: m[2]!, ...(m[3] ? { parent: m[3] } : {}) } : undefined;
}
export function formatTr(p: TraceParts): string { return `${p.traceId}-${p.spanId}${p.parent ? `-${p.parent}` : ""}`; }

/** One finished span, as it is written to logs.db `spans`. */
export interface SpanRow { trace_id: string; span_id: string; parent: string | null; name: string; at: number; dur_us: number; attrs: Record<string, unknown> | null }
export interface SpanSink { span(row: SpanRow): void }

export interface Tracer {
  /** The trace this tracer works in. */
  readonly traceId: string;
  /** The span currently open (the parent of the next one). */
  current(): string | undefined;
  /** Run `fn` inside a new span; the span is recorded when it ends, with `error` in its attrs when `fn` throws. */
  span<T>(name: string, fn: (s: { spanId: string; set(k: string, v: unknown): void }) => T | Promise<T>): Promise<T>;
  context(): TraceContext;
}

/** A tracer for one trace. `from` is the caller's `tr` (its span becomes our parent); without it a new trace starts. */
export function createTracer(sink: SpanSink, o: { from?: TraceParts | undefined; now?: () => number } = {}): Tracer {
  const now = o.now ?? Date.now;
  const traceId = o.from?.traceId ?? newTraceId();
  const stack: string[] = o.from ? [o.from.spanId] : [];
  return {
    traceId,
    current: () => stack[stack.length - 1],
    context: () => ({ traceId, spanId: stack[stack.length - 1] ?? newSpanId() }),
    async span(name, fn) {
      const spanId = newSpanId(), parent = stack[stack.length - 1] ?? null, at = now(), t0 = performance.now();
      const attrs: Record<string, unknown> = {};
      stack.push(spanId);
      try { return await fn({ spanId, set: (k, v) => { attrs[k] = v; } }); }
      catch (e) { attrs["error"] = e instanceof Error ? e.name : "error"; throw e; }
      finally {
        stack.pop();
        sink.span({ trace_id: traceId, span_id: spanId, parent, name, at, dur_us: Math.round((performance.now() - t0) * 1000), attrs: Object.keys(attrs).length ? attrs : null });
      }
    },
  };
}
