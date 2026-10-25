// ui/Plan logic: dates as day numbers, the timeline geometry, the moves a drag or a nudge makes, and the cascade that follows a slip (the prototype's VyreUI.plan, timeline view).
// Everything here is pure, so the tests run it without a renderer.

import type { PlanStatus, PlanTask, PlanWho } from "./types.ts";

export const DAY_MS = 86_400_000;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/* ---------- dates ---------- */

/** Days since 1970-01-01 of an ISO date. */
export function toDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}
export function toIso(day: number): string {
  const t = new Date(day * DAY_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
export const dayOfMonth = (day: number): number => new Date(day * DAY_MS).getUTCDate();
export const weekday = (day: number): number => new Date(day * DAY_MS).getUTCDay();
export const monthOf = (day: number): number => new Date(day * DAY_MS).getUTCMonth();
export const isWeekend = (day: number): boolean => weekday(day) === 0 || weekday(day) === 6;
/** "24 Oct" */
export const fmtDay = (day: number): string => `${dayOfMonth(day)} ${MON[monthOf(day)]}`;
/** "Fri" */
export const fmtWeekday = (day: number): string => DOW[weekday(day)] as string;
const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/* ---------- items ---------- */

export interface Item {
  id: string;
  stage: string;
  milestone: boolean;
  title: string;
  s: number;
  e: number;
  who: PlanWho | null;
  status: PlanStatus;
  effort: string;
  deps: string[];
  fixed: boolean;
}

export function itemOf(t: PlanTask): Item {
  const ms = t.kind === "milestone";
  const s = toDay(t.start);
  return { id: t.id, stage: t.stage, milestone: ms, title: t.title, s, e: ms ? s : toDay(t.end ?? t.start), who: t.assigned ?? null, status: t.status ?? "todo", effort: t.effort ?? "", deps: [...(t.deps ?? [])], fixed: t.fixed === true };
}

/** The task a changed item stands for: everything the host sent comes back, with the edits on top. */
export function taskOf(i: Item, raw: PlanTask | undefined): PlanTask {
  return { ...(raw ?? { id: i.id, stage: i.stage, kind: i.milestone ? "milestone" : "task", title: i.title, start: toIso(i.s) }), id: i.id, stage: i.stage, kind: i.milestone ? "milestone" : "task", title: i.title, start: toIso(i.s), ...(i.milestone ? {} : { end: toIso(i.e) }), assigned: i.who, status: i.status, effort: i.effort, deps: i.deps.slice(), fixed: i.fixed };
}

export const isLate = (i: Item, today: number): boolean => !i.milestone && i.status !== "done" && i.e < today;
export const isWaiting = (i: Item): boolean => i.status === "review" || i.status === "approval" || i.status === "blocked";

export type PlanFilter = "all" | "wait" | "late";
export const FILTER_LABEL: Record<PlanFilter, string> = { all: "All tasks", wait: "Waiting or blocked", late: "Late" };

export function passes(i: Item, f: PlanFilter, today: number): boolean {
  return f === "all" || (f === "wait" && isWaiting(i)) || (f === "late" && isLate(i, today));
}

/* ---------- geometry ---------- */

export const LABEL_W = 220;
export const STAGE_H = 34;
export const ROW_H = 36;
export const HEAD_H = 46;

export interface Geom { d0: number; d1: number; n: number; dw: number; cw: number }

/** The visible days and the width of one day: the chart fills the width it has, a day is 28 to 44 px. */
export function geomOf(items: readonly Item[], today: number, width: number): Geom {
  const mn = Math.min(today, ...items.map((x) => x.s)) - 3;
  const mx = Math.max(today, ...items.map((x) => x.e)) + 5;
  const avail = Math.max(420, width - LABEL_W - 12);
  const n0 = mx - mn + 1;
  const dw = Math.max(28, Math.min(44, Math.floor(avail / n0)));
  const n = Math.max(n0, Math.floor(avail / dw));
  return { d0: mn, d1: mn + n - 1, n, dw, cw: n * dw };
}

export interface Row { y: number; h: number; stage?: { id: string; name: string; all: Item[] }; item?: Item }
export interface Layout { rows: Row[]; height: number; ypos: Record<string, number> }

export function layoutOf(stages: readonly { id: string; name: string }[], items: readonly Item[], collapsed: Readonly<Record<string, boolean>>, f: PlanFilter, today: number): Layout {
  const rows: Row[] = [];
  const ypos: Record<string, number> = {};
  let y = 0;
  for (const st of stages) {
    const all = items.filter((x) => x.stage === st.id);
    rows.push({ y, h: STAGE_H, stage: { id: st.id, name: st.name, all } });
    y += STAGE_H;
    if (collapsed[st.id]) continue;
    const its = all.filter((x) => passes(x, f, today)).sort((a, b) => a.s - b.s || a.e - b.e || Number(a.milestone) - Number(b.milestone));
    for (const it of its) { rows.push({ y, h: ROW_H, item: it }); ypos[it.id] = y; y += ROW_H; }
  }
  return { rows, height: y, ypos };
}

/** The order the keyboard walks: stage by stage, top to bottom, as drawn. */
export const orderOf = (lay: Layout): string[] => lay.rows.flatMap((r) => (r.item ? [r.item.id] : []));

/* ---------- moves and the cascade ---------- */

export interface Change { id: string; s: number; e: number }
export interface Slip { id: string; cause: string; days: number; moves: Change[]; violated: string[]; status: "pending" }

/** Which later tasks a slip pushes: each waits for its dependencies to end (a day after a task, the same day after a milestone). Pinned ones stay and are reported. */
export function cascade(items: readonly Item[], seeds: readonly string[]): { moves: Change[]; violated: string[] } {
  const byId = new Map(items.map((x) => [x.id, x]));
  const pos = new Map(items.map((x) => [x.id, { s: x.s, e: x.e }]));
  const moved = new Set<string>();
  const viol = new Set<string>();
  const q = [...seeds];
  let guard = 0;
  while (q.length > 0 && guard++ < 600) {
    const id = q.shift() as string;
    for (const y of items) {
      if (!y.deps.includes(id) || y.status === "done" || seeds.includes(y.id)) continue;
      const need = Math.max(...y.deps.map((d) => { const p = byId.get(d); const pp = pos.get(d); return (pp?.e ?? 0) + (p?.milestone === true || y.milestone ? 0 : 1); }));
      const me = pos.get(y.id) as { s: number; e: number };
      if (me.s >= need) continue;
      if (y.fixed) { viol.add(y.id); continue; }
      const sh = need - me.s;
      me.s += sh; me.e += sh;
      moved.add(y.id);
      q.push(y.id);
    }
  }
  return { moves: [...moved].map((id) => ({ id, ...(pos.get(id) as { s: number; e: number }) })), violated: [...viol] };
}

export function describeMove(items: readonly Item[], ch: readonly Change[]): string {
  const byId = new Map(items.map((x) => [x.id, x]));
  const first = ch[0] as Change;
  const old = byId.get(first.id) as Item;
  if (ch.length === 1) {
    if (old.milestone) return `${old.title} moved to ${fmtDay(first.s)}`;
    if (first.s === old.s) return `${old.title} now ends ${fmtDay(first.e)}`;
    if (first.e === old.e) return `${old.title} now starts ${fmtDay(first.s)}`;
    const d = first.e - old.e;
    return `${old.title} moved ${plural(Math.abs(d), "day")} ${d > 0 ? "later" : "earlier"}`;
  }
  const d = first.e - old.e;
  return `Moved ${plural(ch.length, "task")} ${plural(Math.abs(d), "day")} ${d > 0 ? "later" : "earlier"}`;
}

export interface MoveResult { items: Item[]; text: string; slip: Slip | null }

/** Apply a set of moves. A move that ends a task later, with later tasks waiting on it, comes back with a slip to apply or keep. */
export function applyMoves(items: readonly Item[], ch: readonly Change[], uid: () => string): MoveResult | null {
  const byId = new Map(items.map((x) => [x.id, x]));
  const real = ch.filter((c) => { const x = byId.get(c.id); return x !== undefined && (x.s !== c.s || x.e !== c.e); });
  if (real.length === 0) return null;
  const text = describeMove(items, real);
  const next = items.map((x) => { const c = real.find((r) => r.id === x.id); return c ? { ...x, s: c.s, e: c.e } : x; });
  let slip: Slip | null = null;
  const slipped = real.filter((c) => c.e > (byId.get(c.id) as Item).e);
  if (slipped.length > 0) {
    const r = cascade(next, real.map((c) => c.id));
    if (r.moves.length > 0 || r.violated.length > 0) {
      const cz = slipped[0] as Change;
      slip = { id: uid(), cause: cz.id, days: cz.e - (byId.get(cz.id) as Item).e, moves: r.moves, violated: r.violated, status: "pending" };
    }
  }
  return { items: next, text, slip };
}

/** A nudge: the selected tasks move by `d` days, or only their end does (`edge`). Pinned ones stay. */
export function nudgeChanges(items: readonly Item[], ids: readonly string[], d: number, edge: boolean): Change[] {
  const out: Change[] = [];
  for (const x of items) if (ids.includes(x.id) && !x.fixed) out.push(edge ? { id: x.id, s: x.s, e: Math.max(x.s, x.e + d) } : { id: x.id, s: x.s + d, e: x.e + d });
  return out;
}

export type DragMode = "mv" | "rs" | "re";

/** What a drag of `d` whole days does to the dragged bar (and, when moving, the whole selection). */
export function dragChanges(items: readonly Item[], mode: DragMode, id: string, ids: readonly string[], d: number): Change[] {
  const out: Change[] = [];
  if (mode === "mv") {
    for (const x of items) if (ids.includes(x.id) && !x.fixed) out.push({ id: x.id, s: x.s + d, e: x.e + d });
    return out;
  }
  const x = items.find((y) => y.id === id);
  if (!x) return out;
  out.push(mode === "rs" ? { id, s: Math.min(x.s + d, x.e), e: x.e } : { id, s: x.s, e: Math.max(x.e + d, x.s) });
  return out;
}

export function setStatus(items: readonly Item[], ids: readonly string[], status: PlanStatus): { items: Item[]; text: string } | null {
  const hit = items.filter((x) => ids.includes(x.id) && x.status !== status);
  if (hit.length === 0) return null;
  const label: Record<PlanStatus, string> = { todo: "to do", doing: "doing", blocked: "blocked", review: "in review", approval: "waiting for approval", done: "done" };
  const text = status === "done" ? (hit.length === 1 ? `${(hit[0] as Item).title} marked done` : `${plural(hit.length, "task")} marked done`) : `${hit.length === 1 ? (hit[0] as Item).title : plural(hit.length, "task")} set to ${label[status]}`;
  return { items: items.map((x) => (ids.includes(x.id) && x.status !== status ? { ...x, status } : x)), text };
}

export function reassign(items: readonly Item[], ids: readonly string[], who: PlanWho | null): { items: Item[]; text: string } | null {
  const hit = items.filter((x) => ids.includes(x.id));
  if (hit.length === 0) return null;
  const text = who ? `${hit.length === 1 ? (hit[0] as Item).title : plural(hit.length, "task")} assigned to ${who.name}` : `${hit.length === 1 ? (hit[0] as Item).title : plural(hit.length, "task")} unassigned`;
  return { items: items.map((x) => (ids.includes(x.id) ? { ...x, who } : x)), text };
}

/** Selection by click: plain replaces, Cmd or Ctrl toggles, Shift takes the range from the anchor. */
export function clickSelect(order: readonly string[], sel: ReadonlySet<string>, anchor: string | null, id: string, mod: boolean, shift: boolean): { sel: Set<string>; anchor: string | null; cur: string } {
  if (mod) { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); return { sel: s, anchor: id, cur: id }; }
  if (shift && anchor !== null && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    return { sel: new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)), anchor, cur: id };
  }
  return { sel: new Set([id]), anchor: id, cur: id };
}

/** The id an arrow key goes to: up and down walk the rows, left goes to a dependency, right to a task that waits on this one. */
export function arrowTarget(items: readonly Item[], order: readonly string[], cur: string | null, key: string): string | null {
  if (order.length === 0) return null;
  if (cur === null || !order.includes(cur)) return key === "ArrowUp" || key === "ArrowLeft" ? (order[order.length - 1] as string) : (order[0] as string);
  const i = order.indexOf(cur);
  if (key === "ArrowUp") return order[Math.max(0, i - 1)] as string;
  if (key === "ArrowDown") return order[Math.min(order.length - 1, i + 1)] as string;
  const it = items.find((x) => x.id === cur) as Item;
  const rel = key === "ArrowLeft" ? it.deps.filter((d) => order.includes(d)) : items.filter((y) => y.deps.includes(cur) && order.includes(y.id)).map((y) => y.id);
  return rel[0] ?? cur;
}
