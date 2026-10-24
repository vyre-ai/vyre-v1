// Deterministic JSON: sorted object keys, 2-space indent, trailing newline.
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    }
    return out;
  }
  return v;
}
