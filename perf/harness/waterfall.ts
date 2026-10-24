// Span waterfall for the worst sample. Printed only when a run exceeds its budget.

import type { Span } from "./types.ts";

function byStart(a: Span, b: Span): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

/** Indented start and duration, parents before children, siblings by start time. */
export function formatWaterfall(spans: Span[]): string {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const children = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const s of spans) {
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    if (!parent) {
      roots.push(s);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(s);
    children.set(parent.id, list);
  }
  roots.sort(byStart);
  const trace = spans[0]?.traceId ?? "none";
  const lines = [`span waterfall ${trace}`];
  const walk = (s: Span, depth: number): void => {
    lines.push(`${"  ".repeat(depth)}${s.startMs.toFixed(2)} ms  ${s.durMs.toFixed(2)} ms  ${s.name}`);
    const kids = children.get(s.id);
    if (!kids) return;
    kids.sort(byStart);
    for (const c of kids) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join("\n");
}
