// One spelling of a value as text, whatever order its keys were written in: what names a read (remote-hooks.ts) and what this device keeps of it (kept.ts). On its own so the sign-in screen,
// which only needs to forget kept answers, does not load the screen hooks with it.
/** Key order does not change a query's identity. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}
