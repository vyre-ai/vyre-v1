// Cmd-K model (spec 3.0, ARCH 7.0): query parsing, type filters, the local plus server merge and the row list. Pure functions, no React.
// The device searches its own replica first and never waits for the server; server hits merge in as they arrive and never move a local row.
import type { CapMap } from "../../../../../generated/types.ts";

export type Hit = CapMap["search.query"]["out"]["hits"][number];
export type HitKind = Hit["kind"];
export type CmdAction = CapMap["search.actions.list"]["out"]["actions"][number];

export type Prefix = "@" | "#" | "/" | ">";

/** `@` people and agents; `#` chats and records; `/` files; `>` actions (spec 3.0, the second symbol table). */
export const PREFIX_TYPES: Readonly<Record<Exclude<Prefix, ">">, readonly HitKind[]>> = {
  "@": ["person", "agent"],
  "#": ["chat", "channel", "record", "task"],
  "/": ["file"],
};

export interface ParsedQuery {
  prefix: Prefix | null;
  /** The text after the prefix, trimmed on the left. */
  text: string;
  /** Kinds the prefix narrows to, or null when there is no kind prefix. */
  types: readonly HitKind[] | null;
}

export function parseQuery(raw: string): ParsedQuery {
  const s = raw.replace(/^\s+/, "");
  const first = s.charAt(0);
  if (first === "@" || first === "#" || first === "/") return { prefix: first, text: s.slice(1).replace(/^\s+/, ""), types: PREFIX_TYPES[first] };
  if (first === ">") return { prefix: ">", text: s.slice(1).replace(/^\s+/, ""), types: null };
  return { prefix: null, text: s.trim(), types: null };
}

/* ---------- type filters (a quiet header menu with checkmarks and counts, never a row of pills) ---------- */

export interface FilterGroup {
  id: string;
  label: string;
  kinds: readonly HitKind[];
}

export const FILTERS: readonly FilterGroup[] = [
  { id: "people", label: "People", kinds: ["person"] },
  { id: "agents", label: "Agents", kinds: ["agent"] },
  { id: "chats", label: "Chats", kinds: ["chat", "channel"] },
  { id: "inbox", label: "Inbox", kinds: ["inbox"] },
  { id: "records", label: "Records", kinds: ["record", "task"] },
  { id: "files", label: "Files", kinds: ["file"] },
  { id: "automations", label: "Automations", kinds: ["automation"] },
  { id: "apps", label: "Apps", kinds: ["app"] },
  { id: "settings", label: "Settings", kinds: ["setting"] },
  { id: "memory", label: "Memory", kinds: ["memory"] },
];

export function filterKinds(selected: readonly string[]): readonly HitKind[] | null {
  if (selected.length === 0) return null;
  const out: HitKind[] = [];
  for (const g of FILTERS) if (selected.includes(g.id)) out.push(...g.kinds);
  return out;
}

/** The kinds a search covers: the prefix kinds narrowed by the chosen filters. null means every kind. */
export function effectiveTypes(parsed: ParsedQuery, selected: readonly string[]): readonly HitKind[] | null {
  const f = filterKinds(selected);
  if (parsed.types && f) return parsed.types.filter((k) => f.includes(k));
  return parsed.types ?? f;
}

export function filterCounts(hits: readonly Hit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of FILTERS) out[g.id] = hits.filter((h) => g.kinds.includes(h.kind)).length;
  return out;
}

/* ---------- merge ---------- */

const keyOf = (h: Hit): string => `${h.kind}:${h.id}`;

/** Local hits keep their place; server hits that the device does not hold follow, best score first. A server hit for a row the device already shows only fills a missing snippet. */
export function mergeHits(local: readonly Hit[], server: readonly Hit[]): Hit[] {
  const seen = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of local) {
    const k = keyOf(h);
    if (seen.has(k)) continue;
    seen.set(k, out.length);
    out.push(h);
  }
  const extra: Hit[] = [];
  for (const h of server) {
    const k = keyOf(h);
    const at = seen.get(k);
    if (at !== undefined) {
      const mine = out[at];
      if (mine && mine.snippet === undefined && h.snippet !== undefined) out[at] = { ...mine, snippet: h.snippet };
      continue;
    }
    seen.set(k, -1);
    extra.push(h);
  }
  extra.sort((a, b) => b.score - a.score);
  return [...out, ...extra];
}

/* ---------- rows ---------- */

export const GROUPS: readonly (readonly [HitKind, string])[] = [
  ["agent", "Agents"], ["chat", "Chats"], ["channel", "Channels"], ["person", "People"], ["inbox", "Inbox"], ["record", "Records"],
  ["task", "Tasks"], ["file", "Files"], ["automation", "Automations"], ["app", "Apps"], ["setting", "Settings"], ["memory", "Memory"],
];

export type RowModel =
  | { type: "head"; key: string; title: string }
  | { type: "hit"; key: string; hit: Hit }
  | { type: "action"; key: string; action: CmdAction }
  | { type: "skin"; key: string; id: string; name: string; swatch?: string; current: boolean }
  | { type: "empty"; key: string; title: string };

export const isSelectable = (r: RowModel): boolean => r.type === "hit" || r.type === "action" || r.type === "skin";

export function groupRows(hits: readonly Hit[], cap: number): RowModel[] {
  const rows: RowModel[] = [];
  for (const [kind, title] of GROUPS) {
    const part = hits.filter((h) => h.kind === kind).slice(0, cap);
    if (!part.length) continue;
    rows.push({ type: "head", key: `h-${kind}`, title });
    for (const hit of part) rows.push({ type: "hit", key: `hit-${keyOf(hit)}`, hit });
  }
  return rows;
}

export const SKIN_ACTION = "appearance.skin";

/** `> skin` lists the skins; the rest of the `>` text filters the action titles. */
export function isSkinQuery(text: string): boolean {
  return /^(switch\s+)?skins?\b/i.test(text);
}

export function actionRows(actions: readonly CmdAction[], text: string): RowModel[] {
  const q = text.toLowerCase();
  const part = actions.filter((a) => !q || a.title.toLowerCase().includes(q));
  return part.length ? [{ type: "head", key: "h-actions", title: "Actions" }, ...part.map((a): RowModel => ({ type: "action", key: `act-${a.key}`, action: a }))] : [];
}

/** Next selectable row index in a direction, wrapping. -1 when nothing can be chosen. */
export function stepActive(rows: readonly RowModel[], from: number, dir: 1 | -1 | "first" | "last"): number {
  const sel: number[] = [];
  rows.forEach((r, i) => { if (isSelectable(r)) sel.push(i); });
  if (!sel.length) return -1;
  if (dir === "first") return sel[0] ?? -1;
  if (dir === "last") return sel[sel.length - 1] ?? -1;
  const at = sel.indexOf(from);
  if (at < 0) return (dir === 1 ? sel[0] : sel[sel.length - 1]) ?? -1;
  return sel[(at + dir + sel.length) % sel.length] ?? -1;
}
