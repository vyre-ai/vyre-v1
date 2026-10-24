// Span waterfall for the worst sample. Parents print before their children.

import type { Span } from "./types.ts";

function byStart(a: Span, b: Span): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

/** Indented trace. Durations are end minus start on the fake clock. */
export function formatWaterfall(spans: readonly Span[], traceId: string, value: number, unit: string): string {
  const lines = [`worst sample ${value} ${unit} trace ${traceId}`];
  if (spans.length === 0) {
    lines.push("(no spans)");
    return lines.join("\n");
  }
  const byParent = new Map<string | null, Span[]>();
  for (const span of spans) {
    const list = byParent.get(span.parentId) ?? [];
    list.push(span);
    byParent.set(span.parentId, list);
  }
  for (const list of byParent.values()) list.sort(byStart);
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): void => {
    const kids = byParent.get(parent);
    if (!kids) return;
    for (const span of kids) {
      if (seen.has(span.id)) continue;
      seen.add(span.id);
      lines.push(`${"  ".repeat(depth)}${span.name} ${span.startMs} ms for ${span.endMs - span.startMs} ms`);
      walk(span.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const span of spans) {
    if (seen.has(span.id)) continue;
    lines.push(`${span.name} ${span.startMs} ms for ${span.endMs - span.startMs} ms`);
  }
  return lines.join("\n");
}
