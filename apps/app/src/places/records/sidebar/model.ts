// Records sidebar model: the pure part. Record types in their groups (Records first, a Sites group for site tables last), the saved views of the open type, and the state the
// sidebar and the table share (which type is open, which saved view, which sections are folded). No React.
import type { CapMap } from "../../../../../../generated/types.ts";

export type TypeRow = CapMap["schema.types.list"]["out"]["types"][number];
export type ViewRow = CapMap["views.list"]["out"]["views"][number];

export const SCREENS = { types: "records.types", views: "records.saved-views" } as const;
export const DEFAULT_GROUP = "Records";
export const SITES_GROUP = "Sites";

export interface TypeGroup { key: string; label: string; items: TypeItem[] }
export interface TypeItem { key: string; label: string; icon: string; count: number; synced: boolean; syncedFrom?: string; system: boolean }

/** A site table belongs to its site: the scope names it ("site:northwind"). */
export function isSiteTable(t: TypeRow): boolean {
  return t.scope !== undefined && t.scope.startsWith("site");
}

function siteName(scope: string): string {
  const raw = scope.includes(":") ? scope.slice(scope.indexOf(":") + 1) : scope;
  return raw.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The sidebar's groups: each `group` in the order it first appears, Records (the ungrouped types) first, Sites last. A site table reads "Site › Table". */
export function typeGroups(types: readonly TypeRow[]): TypeGroup[] {
  const groups = new Map<string, TypeGroup>();
  const put = (label: string, item: TypeItem): void => {
    let g = groups.get(label);
    if (!g) groups.set(label, (g = { key: label, label, items: [] }));
    g.items.push(item);
  };
  for (const t of types) {
    const site = isSiteTable(t);
    put(site ? SITES_GROUP : t.group ?? DEFAULT_GROUP, {
      key: t.key, label: site && t.scope ? `${siteName(t.scope)} › ${t.plural}` : t.plural, icon: t.icon, count: t.rowCount, synced: t.syncedFrom !== undefined, ...(t.syncedFrom !== undefined ? { syncedFrom: t.syncedFrom } : {}), system: t.system,
    });
  }
  const order = [...groups.values()];
  const rank = (g: TypeGroup): number => (g.label === DEFAULT_GROUP ? 0 : g.label === SITES_GROUP ? 2 : 1);
  return order.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

/** The saved views of a type: yours first, then the shared ones, each alphabetically. */
export function sortedViews(views: readonly ViewRow[], me: string | null): ViewRow[] {
  return views.slice().sort((a, b) => Number(b.ownerId === me) - Number(a.ownerId === me) || a.title.localeCompare(b.title));
}

export function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

// ---------------------------------------------------------------- state

export interface RecordsState {
  /** The open record type, or null (the place opens on the first one). */
  type: string | null;
  /** The saved view applied to it, or null for the plain table. */
  viewId: string | null;
  /** Section keys folded shut. */
  closed: readonly string[];
}

export const INITIAL_STATE: RecordsState = { type: null, viewId: null, closed: [] };

export type Action =
  | { type: "open"; key: string; viewId?: string }
  | { type: "view"; viewId: string | null }
  | { type: "section"; key: string };

export function reduce(s: RecordsState, a: Action): RecordsState {
  switch (a.type) {
    case "open": return { ...s, type: a.key, viewId: a.viewId ?? null };
    case "view": return { ...s, viewId: a.viewId };
    case "section": return { ...s, closed: s.closed.includes(a.key) ? s.closed.filter((k) => k !== a.key) : [...s.closed, a.key] };
  }
}

/** The type to show: the open one if the person can still see it, else the first of the first group. */
export function effectiveType(s: RecordsState, groups: readonly TypeGroup[]): string | null {
  const all = groups.flatMap((g) => g.items);
  if (s.type && all.some((i) => i.key === s.type)) return s.type;
  return all[0]?.key ?? null;
}
