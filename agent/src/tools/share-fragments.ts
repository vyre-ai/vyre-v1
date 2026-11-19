// Shared descriptions (lane r42-mcp, 19 Nov 2026, owner: what a model is shown of its tools only goes down). A large piece of input schema that a few tools carry word for word (the AI settings of a goal or an
// Automation, a step list) keeps its words in the first tool that holds it, by name; in the others the same shape is shown without the descriptions. The capability's own contract and the server's
// validation are untouched: this is only the copy a model reads. The sync spec tools are left to their own sharing (share.ts of lane r41-automations).
import type { ToolDef } from "./types.ts";

/** A fragment shorter than this is not worth a pointer. */
export const MIN_SHARED = 250;
/** The fewest tools that must carry a fragment before it is shared. */
export const MIN_TOOLS = 3;
const SKIP = /^sync_specs_/;

const json = (v: unknown): string => JSON.stringify(v);

function visit(n: unknown, f: (node: Record<string, unknown>, path: string) => void, path = ""): void {
  if (n === null || typeof n !== "object") return;
  if (Array.isArray(n)) {
    n.forEach((x, i) => visit(x, f, `${path}/${i}`));
    return;
  }
  const o = n as Record<string, unknown>;
  f(o, path);
  for (const [k, x] of Object.entries(o)) visit(x, f, `${path}/${k}`);
}

/** Replace every later copy of a large repeated fragment with a pointer to the first tool that shows it. */
export function shareFragments<T extends Pick<ToolDef, "name" | "inputSchema">>(defs: readonly T[]): T[] {
  const sorted = [...defs].sort((a, b) => (a.name < b.name ? -1 : 1));
  // which tools carry each large fragment
  const holders = new Map<string, Set<string>>();
  for (const d of sorted) {
    if (SKIP.test(d.name)) continue;
    visit(d.inputSchema, (node) => {
      if (node["properties"] === undefined && node["items"] === undefined) return;
      const s = json(node);
      if (s.length < MIN_SHARED) return;
      const set = holders.get(s) ?? new Set<string>();
      set.add(d.name);
      holders.set(s, set);
    });
  }
  const shared = new Map<string, string>(); // fragment -> the tool that shows it in full
  for (const [s, set] of holders) if (set.size >= MIN_TOOLS) shared.set(s, [...set][0] as string);
  if (shared.size === 0) return [...defs];
  // a later copy keeps its whole shape (types, enums, required, nesting): only the descriptions go, since the first copy in the catalog carries them. Nothing the server or a model needs to write a valid
  // call is dropped, so no tool depends on another being listed.
  const bare = (n: unknown): unknown => {
    if (n === null || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(bare);
    return Object.fromEntries(
      Object.entries(n as Record<string, unknown>)
        .filter(([k, x]) => !(k === "description" && typeof x === "string"))
        .map(([k, x]) => [k, bare(x)]),
    );
  };
  const rewrite = (n: unknown, owner: string): unknown => {
    if (n === null || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map((x) => rewrite(x, owner));
    const o = n as Record<string, unknown>;
    const first = shared.get(json(o));
    if (first !== undefined && first !== owner) return bare(o);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, rewrite(x, owner)]));
  };
  return defs.map((d) => (SKIP.test(d.name) ? d : { ...d, inputSchema: rewrite(d.inputSchema, d.name) as T["inputSchema"] }));
}
