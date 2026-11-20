// A schema property too big to say three times (rc.41): the SyncSpec tools each carried the whole spec, 6.6 kB apiece. Within a named group the first tool shows the property in full and the others show a short pointer to it.
// The capability's own contract is untouched: the server still checks every field of every call, so nothing is dropped, only said once to the model. Only the groups named here are shared (the lead chose them):
// a tool a model may meet first, with no sibling to read the shape from, keeps its own copy.
import type { ToolDef } from "./types.ts";

/** A property under this size is said again where it is used: a pointer would not be shorter than the thing. */
export const SHARE_MIN_CHARS = 1200;

/** Tools that take one large object between them, the one a model meets first listed first (check, then preview, then apply). */
export const SHARE_GROUPS: readonly (readonly string[])[] = [
  ["sync_specs_validate", "sync_specs_preview", "sync_specs_apply"],
];

type Obj = Record<string, unknown>;

/** The tools, with each large repeated top-level property of a group shown in full once and pointed at after. */
export function shareRepeats(
  defs: readonly ToolDef[],
  groups: readonly (readonly string[])[] = SHARE_GROUPS,
): ToolDef[] {
  const order = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((n, i) => order.set(n, gi * 1000 + i)));
  const first = new Map<string, { tool: string; key: string }>();
  const grouped = defs.filter((d) => order.has(d.name)).sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const replaced = new Map<string, ToolDef>();
  for (const d of grouped) {
    const schema = d.inputSchema as { properties?: Record<string, unknown> } | null;
    const props = schema?.properties;
    if (!props) continue;
    let next: Record<string, unknown> | undefined;
    for (const [key, p] of Object.entries(props)) {
      const text = JSON.stringify(p);
      if (text.length < SHARE_MIN_CHARS) continue;
      const tag = `${Math.floor(order.get(d.name)! / 1000)}:${text}`;
      const seen = first.get(tag);
      if (!seen) {
        first.set(tag, { tool: d.name, key });
        continue;
      }
      const o = p as Obj;
      next = next ?? { ...props };
      next[key] = {
        type: o["type"] ?? "object",
        additionalProperties: true,
        // the names it must carry stay: a model that has not read the full shape still knows what to fill
        ...(Array.isArray(o["required"]) ? { required: o["required"] } : {}),
        description: `The same ${seen.key === key ? key : `${seen.key} (as ${key})`} as ${seen.tool}: read its shape there.`,
      };
    }
    if (next) replaced.set(d.name, { ...d, inputSchema: { ...(schema as Obj), properties: next } });
  }
  return defs.map((d) => replaced.get(d.name) ?? d);
}
