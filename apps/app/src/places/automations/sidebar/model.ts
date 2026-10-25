// The Automations sidebar model (spec 3.7): which Automations sit in which section, the Groups under them, Needs you and Running at the top and bottom, the search, and the order the
// arrow keys walk. Pure functions over the lists the screen's live queries return.
import type { CapMap } from "../../../../../../generated/types.ts";

export type AutoRow = CapMap["automations.list"]["out"]["automations"][number];
export type GroupRow = CapMap["automations.groups.list"]["out"]["groups"][number];
export type JourneyRow = CapMap["journeys.list"]["out"]["journeys"][number];

export type SectionKey = "needs" | "personal" | "shared" | "space" | "running";

export interface GroupBlock { id: string; name: string; rows: AutoRow[]; failed: number; /** the Group holds no Automation anywhere, so Space shows it ready to fill */ empty: boolean }
export interface Section { key: SectionKey; title: string; count: number; /** Automations not in a group, listed directly */ loose: AutoRow[]; groups: GroupBlock[]; canAdd: boolean }

/** Why an Automation is in Needs you: it is paused (a key or connection is missing, an approval waits) or its last run failed. */
export function needsYou(a: AutoRow): boolean {
  return a.status === "paused" || a.failedRuns > 0 || a.lastRun?.status === "failed";
}
export function isRunning(a: AutoRow): boolean {
  return a.lastRun?.status === "running";
}

export function noteOf(a: AutoRow, reasons: Readonly<Record<string, string>> = {}): string {
  const r = reasons[a.id];
  if (r) return r;
  if (a.status === "paused") return "Paused";
  if (a.failedRuns > 0) return `${a.kind === "personal" ? "Personal, " : ""}${a.failedRuns} run${a.failedRuns === 1 ? "" : "s"} failed`;
  if (a.status === "off" || a.status === "draft") return a.status === "draft" ? "Draft" : "Off";
  return a.triggers.length > 0 ? a.triggers[0]! : "";
}

export function matches(a: AutoRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return needle === "" || a.name.toLowerCase().includes(needle);
}

/** Sections in the order the sidebar shows them. `shared` rows are the ones other people own that were shared with this person; the caller says which. */
export function sectionsOf(autos: readonly AutoRow[], groups: readonly GroupRow[], opts: { me: string; q?: string; shared?: ReadonlySet<string>; reasons?: Readonly<Record<string, string>> }): Section[] {
  const q = opts.q ?? "";
  const rows = autos.filter((a) => matches(a, q));
  const sharedIds = opts.shared ?? new Set<string>();
  const byGroup = (list: AutoRow[], showEmpty = false): { loose: AutoRow[]; groups: GroupBlock[] } => {
    const loose: AutoRow[] = [];
    const blocks = new Map<string, GroupBlock>();
    for (const g of [...groups].sort((x, y) => x.order - y.order)) blocks.set(g.id, { id: g.id, name: g.name, rows: [], failed: 0, empty: g.count === 0 });
    for (const a of list) {
      const b = a.groupId ? blocks.get(a.groupId) : undefined;
      if (b) { b.rows.push(a); b.failed += a.failedRuns; } else loose.push(a);
    }
    return { loose, groups: [...blocks.values()].filter((b) => b.rows.length > 0 || (showEmpty && b.empty && q === "")) };
  };
  const needs = rows.filter(needsYou);
  const personal = rows.filter((a) => a.kind === "personal" && a.ownerId === opts.me);
  const shared = rows.filter((a) => sharedIds.has(a.id));
  const space = rows.filter((a) => a.kind === "space" && !sharedIds.has(a.id));
  const running = rows.filter(isRunning);
  const out: Section[] = [];
  if (needs.length > 0) out.push({ key: "needs", title: "Needs you", count: needs.length, loose: needs, groups: [], canAdd: false });
  const p = byGroup(personal);
  out.push({ key: "personal", title: "Personal", count: personal.length, ...p, canAdd: true });
  if (shared.length > 0 || q === "") { const sg = byGroup(shared); out.push({ key: "shared", title: "Shared with me", count: shared.length, ...sg, canAdd: false }); }
  const sp = byGroup(space, true);
  out.push({ key: "space", title: "Space", count: space.length, ...sp, canAdd: true });
  if (running.length > 0) out.push({ key: "running", title: "Running", count: running.length, loose: running, groups: [], canAdd: false });
  return out;
}

/** Row ids in the order they are on screen, for the arrow keys. Collapsed groups hide their rows. */
export function visibleOrder(sections: readonly Section[], open: ReadonlySet<string>, collapsed: ReadonlySet<SectionKey>): string[] {
  const out: string[] = [];
  for (const s of sections) {
    if (collapsed.has(s.key)) continue;
    for (const a of s.loose) out.push(`${s.key}:${a.id}`);
    for (const g of s.groups) {
      out.push(`group:${s.key}:${g.id}`);
      if (open.has(`${s.key}:${g.id}`)) for (const a of g.rows) out.push(`${s.key}:${a.id}`);
    }
  }
  return out;
}

export function nextId(order: readonly string[], from: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = from === null ? -1 : order.indexOf(from);
  if (at < 0) return dir === 1 ? order[0]! : order[order.length - 1]!;
  return order[Math.max(0, Math.min(order.length - 1, at + dir))] ?? null;
}

export function failedTotal(autos: readonly AutoRow[]): number {
  let n = 0;
  for (const a of autos) n += a.failedRuns;
  return n;
}

export function journeyNote(j: JourneyRow): string {
  return `${j.stages} ${j.stages === 1 ? "stage" : "stages"}${j.inFlight > 0 ? `, ${j.inFlight} in flight` : ""}`;
}

export function allGroupKeys(sections: readonly Section[]): Set<string> {
  const out = new Set<string>();
  for (const s of sections) for (const g of s.groups) out.add(`${s.key}:${g.id}`);
  return out;
}
