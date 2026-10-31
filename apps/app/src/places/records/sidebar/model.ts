// Records sidebar model: the pure part. Record types in their groups (Records first, a Sites group for site tables last), the saved views of the open type, and the state the
// sidebar and the table share (which type is open, which saved view, which sections are folded). No React.
import type { CapMap } from "../../../../../../generated/types.ts";

export type TypeRow = CapMap["schema.types.list"]["out"]["types"][number];
export type ViewRow = CapMap["views.list"]["out"]["views"][number];

export const SCREENS = { types: "records.types", views: "records.saved-views" } as const;
export const DEFAULT_GROUP = "Records";
export const SITES_GROUP = "Sites";

/**
 * Types a connector, a module or the system writes into. A Space starts with Contacts only: these exist because modules need them (Contacts link to Companies, the Meetings module writes
 * Meetings, Projects and Tasks hold the work) but stay out of the sidebar and the Record types page while they are empty, and show as soon as they hold a record (the first project or
 * task made from anywhere makes Projects and Tasks appear). Envelopes wait for e-sign, Issues and Pull requests for GitHub, Problem reports for a report.
 */
export const HIDDEN_WHEN_EMPTY: ReadonlySet<string> = new Set(["envelope", "issue", "pull_request", "report", "company", "meeting", "note_board", "project", "task", "agent"]);

/** Agents live in Chats; their record type is a Manage row of the sidebar (next to Record types and Schema map), never a type group. */
export const MANAGE_TYPE = "agent";

/** Is this type worth showing? The internal ones (Envelopes, Problem reports) only once they hold a record; Issues and Pull requests once GitHub is connected (the type is synced from it) or they hold a record. */
export function worthShowing(t: Pick<TypeRow, "key" | "rowCount" | "syncedFrom">): boolean {
  if (!HIDDEN_WHEN_EMPTY.has(t.key) || t.rowCount > 0) return true;
  return (t.key === "issue" || t.key === "pull_request") && t.syncedFrom === "github";
}

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
    if (t.key === MANAGE_TYPE || !worthShowing(t)) continue;
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

/** A count in the sidebar: whole numbers up to 10,000 ("1,240", as the prototype draws them), then 12k and 2.5M. */
export function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-US");
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
  if (s.type === MANAGE_TYPE) return MANAGE_TYPE;
  if (s.type && all.some((i) => i.key === s.type)) return s.type;
  return all[0]?.key ?? null;
}

/** A phone has no sidebar beside the table: the type name in the header opens this menu to switch record types. Every shown type, then Agents when it is not already in a group. */
export function typeMenuEntries(types: readonly TypeRow[], current: string, open: (key: string) => void): { label: string; checked: boolean; onSelect: () => void }[] {
  const all = typeGroups(types).flatMap((g) => g.items);
  const out = all.map((t) => ({ label: t.label, checked: t.key === current, onSelect: () => open(t.key) }));
  const agent = types.find((t) => t.key === "agent");
  if (agent !== undefined && !all.some((t) => t.key === "agent")) out.push({ label: agent.plural, checked: current === "agent", onSelect: () => open("agent") });
  return out;
}
