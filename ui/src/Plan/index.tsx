// ui/Plan: the one Plan timeline (the prototype's VyreUI.plan, view "timeline"). Tasks are bars from start to end by day, milestones are diamonds, a line marks today, arrows show what waits on what,
// faces show who has each task. Drag a bar to move it or its ends to resize; Alt-arrows nudge; a slip that pushes later tasks asks to move them or keep their dates. Right-click opens the shared Menu.
// Home My work (Plan mode), a project's and a Journey's Plan tab and the record plan all mount this. Web draws the chart with DOM; native lists the tasks (no drag there yet).
// Colours are skin tokens (CSS variables), so a skin switch repaints with no re-render.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import {
  FILTER_LABEL, HEAD_H, LABEL_W, MON, MONL, ROW_H, STAGE_H, applyMoves, arrowTarget, cascade, clickSelect, dayOfMonth, dragChanges, fmtDay, fmtWeekday, geomOf, isLate, isWeekend, itemOf, layoutOf, monthOf, nudgeChanges, orderOf,
  reassign, setStatus, taskOf, toDay, weekday,
} from "./logic.ts";
import type { Change, DragMode, Geom, Item, PlanFilter, Slip } from "./logic.ts";
import type { PlanProps, PlanStatus, PlanTask, PlanWho } from "./types.ts";

export type { PlanProps, PlanStage, PlanStatus, PlanTask, PlanWho } from "./types.ts";
export * from "./logic.ts";

const web = Platform.OS === "web";

/** The few DOM members the chart touches (this repo compiles without the DOM lib). */
interface ElLike {
  clientWidth: number;
  closest(selector: string): ElLike | null;
  focus(o?: { preventScroll?: boolean }): void;
  scrollTo(o: { left: number; behavior?: string }): void;
  getBoundingClientRect(): { left: number; bottom: number };
}
interface EventLike {
  button?: number; clientX: number; clientY: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean; key?: string;
  target: ElLike; currentTarget: ElLike; preventDefault(): void; stopPropagation(): void;
}
interface Win { addEventListener(t: string, f: (e: EventLike) => void, o?: { once?: boolean }): void; removeEventListener(t: string, f: (e: EventLike) => void): void }
const win = (): Win => globalThis as unknown as Win;
/** DOM elements by tag, with loose props: the chart handlers take the small EventLike above, not the DOM lib's event types. */
const h = createElement as unknown as (tag: string | ((p: never) => ReactElement), props: Record<string, unknown> | null, ...children: ReactNode[]) => ReactElement;

/** Status paints the bar: a wash of the status colour with a line of it, never a filled block. */
const BAR: Record<PlanStatus, { bg: string; line: string }> = {
  todo: { bg: "var(--sunk)", line: "var(--ink-4)" },
  doing: { bg: "color-mix(in srgb, var(--accent) 14%, var(--win))", line: "var(--accent)" },
  blocked: { bg: "color-mix(in srgb, var(--warn) 16%, var(--win))", line: "var(--warn)" },
  review: { bg: "color-mix(in srgb, var(--accent) 10%, var(--win))", line: "var(--accent)" },
  approval: { bg: "color-mix(in srgb, var(--accent) 10%, var(--win))", line: "var(--accent)" },
  done: { bg: "color-mix(in srgb, var(--ok) 14%, var(--win))", line: "var(--ok)" },
};

const SVG = (children: string, size = 13): string => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
const ICON = {
  chev: SVG('<path d="M4 6l4 4 4-4"/>', 12),
  diamond: SVG('<path d="M8 2.5l5 5.5-5 5.5L3 8z"/>', 14),
  filter: SVG('<path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>', 14),
  check: SVG('<path d="M3.5 8.5l3 3 6-7"/>', 12),
  pin: SVG('<path d="M6 2.5h4l-.7 4 2 2.2H4.7l2-2.2zM8 8.7v4.8"/>', 11),
};
const icon = (svg: string): ReactElement => h("span", { style: { display: "inline-flex" }, dangerouslySetInnerHTML: { __html: svg } });

/** The small status mark in the label column. */
function StatusMark({ status }: { status: PlanStatus }): ReactElement {
  const ring = status === "done" ? "var(--ok)" : status === "blocked" ? "var(--warn)" : status === "todo" ? "var(--ink-4)" : "var(--accent)";
  const inner = status === "done" ? '<path d="M5 8.2l2.2 2.2L11 6" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : status === "doing" ? '<path d="M8 4.6a3.4 3.4 0 010 6.8z" fill="var(--accent)"/>' : status === "review" || status === "approval" ? '<path d="M5.2 8.2l1.9 1.9L10.9 6" stroke="var(--ink-2)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : status === "blocked" ? '<path d="M5.2 8h5.6" stroke="var(--warn)" stroke-width="1.8" stroke-linecap="round"/>' : "";
  const fill = status === "done" ? "var(--ok)" : "none";
  return h("span", { "data-status": status, style: { display: "inline-flex" }, dangerouslySetInnerHTML: { __html: `<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="${status === "done" ? 7 : 6.2}" fill="${fill}" stroke="${status === "done" ? "none" : status === "review" || status === "approval" ? "var(--ink-3)" : ring}" stroke-width="1.5"/>${inner}</svg>` } });
}

const faceKind = (w: PlanWho): "person" | "agent" | "group" => (w.kind === "agent" ? "agent" : w.kind === "person" ? "person" : "group");
const Face = ({ who, size }: { who: PlanWho; size: number }): ReactElement => <Avatar name={who.name} kind={faceKind(who)} size={size} />;

interface Snapshot { text: string; items: Item[]; slips: Slip[] }
interface DragState { mode: DragMode; id: string; ids: string[]; x0: number; y0: number; dw: number; moved: boolean; deferred: boolean }

let uidn = 0;
const uid = (): string => `s${++uidn}`;

/** The routed path of a dependency arrow: right, down or up, right, with rounded corners. */
export function roundedPath(pts: readonly (readonly [number, number])[], r: number): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] as readonly [number, number], [x1, y1] = pts[i] as readonly [number, number], [x2, y2] = pts[i + 1] as readonly [number, number];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1), k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) { d += `L${x1} ${y1}`; continue; }
    d += `L${x1 - ((x1 - x0) / l1) * k} ${y1 - ((y1 - y0) / l1) * k}Q${x1} ${y1} ${x1 + ((x2 - x1) / l2) * k} ${y1 + ((y2 - y1) / l2) * k}`;
  }
  const last = pts[pts.length - 1] as readonly [number, number];
  return `${d}L${last[0]} ${last[1]}`;
}

export function Plan(props: PlanProps): ReactElement {
  const today = toDay(props.today);
  const raw = useRef<Map<string, PlanTask>>(new Map());
  const [items, setItems] = useState<Item[]>(() => props.tasks.map(itemOf));
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<PlanFilter>("all");
  const [slips, setSlips] = useState<Slip[]>([]);
  const [undo, setUndo] = useState<Snapshot[]>([]);
  const [line, setLine] = useState<string | null>(null);
  const [tmp, setTmp] = useState<Record<string, { s: number; e: number }> | null>(null);
  const [width, setWidth] = useState(900);
  const drag = useRef<DragState | null>(null);
  const box = useRef<ElLike | null>(null);
  const scroller = useRef<ElLike | null>(null);
  const menu = useMenu();

  useEffect(() => { raw.current = new Map(props.tasks.map((t) => [t.id, t])); setItems(props.tasks.map(itemOf)); }, [props.tasks]);
  useEffect(() => {
    if (!web) return;
    const measure = (): void => { const w = box.current?.clientWidth; if (w) setWidth(w); };
    measure();
    win().addEventListener("resize", measure);
    return () => win().removeEventListener("resize", measure);
  }, []);

  const eff = useCallback((i: Item): Item => (tmp && tmp[i.id] ? { ...i, ...(tmp[i.id] as { s: number; e: number }) } : i), [tmp]);
  const shown = useMemo(() => items.map(eff), [items, eff]);
  const g: Geom = useMemo(() => geomOf(shown, today, width), [shown, today, width]);
  const lay = useMemo(() => layoutOf(props.stages, shown, collapsed, filter, today), [props.stages, shown, collapsed, filter, today]);
  const order = useMemo(() => orderOf(lay), [lay]);

  const emit = (next: Item[], reason: string): void => { props.onChange?.(next.map((i) => taskOf(i, raw.current.get(i.id))), reason); };
  /** Every change goes through here: keep a snapshot for undo, show the line, tell the host. */
  const commit = (next: Item[], text: string, nextSlips: Slip[] = slips): void => {
    setUndo((u) => [...u.slice(-39), { text, items, slips }]);
    setItems(next); setSlips(nextSlips); setLine(text);
    emit(next, text);
  };
  const undoLast = (): boolean => {
    const s = undo[undo.length - 1];
    if (!s) return false;
    setUndo(undo.slice(0, -1)); setItems(s.items); setSlips(s.slips); setLine(null);
    emit(s.items, `Undone: ${s.text}`);
    return true;
  };

  const doMoves = (ch: readonly Change[]): void => {
    const r = applyMoves(items, ch, uid);
    if (!r) return;
    commit(r.items, r.text, r.slip ? [r.slip, ...slips.filter((s) => s.cause !== r.slip?.cause)] : slips);
  };
  const doStatus = (ids: readonly string[], status: PlanStatus): void => { const r = setStatus(items, ids, status); if (r) commit(r.items, r.text); };
  const toggleDone = (ids: readonly string[]): void => doStatus(ids, ids.every((id) => items.find((x) => x.id === id)?.status === "done") ? "todo" : "done");
  const applySlip = (s: Slip): void => {
    const next = items.map((x) => { const m = s.moves.find((c) => c.id === x.id); return m ? { ...x, s: m.s, e: m.e } : x; });
    commit(next, `${s.moves.length === 1 ? "1 later task" : `${s.moves.length} later tasks`} moved`, slips.filter((x) => x.id !== s.id));
  };
  const keepSlip = (s: Slip): void => { setSlips(slips.filter((x) => x.id !== s.id)); setLine("Later tasks keep their dates"); };

  const open = (id: string): void => { const t = items.find((x) => x.id === id); if (t && props.onOpenTask) props.onOpenTask(taskOf(t, raw.current.get(id))); };
  const select = (id: string, mod: boolean, shift: boolean): void => { const r = clickSelect(order, sel, anchor, id, mod, shift); setSel(r.sel); setAnchor(r.anchor); setCur(r.cur); };
  const only = (id: string): void => { setSel(new Set([id])); setAnchor(id); setCur(id); };

  /* ---------- menus ---------- */
  const openMenu = (id: string, x: number, y: number): void => {
    const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id];
    if (!sel.has(id)) only(id);
    const multi = ids.length > 1;
    const t = items.find((i) => i.id === id) as Item;
    const allDone = ids.every((i) => items.find((q) => q.id === i)?.status === "done");
    const entries: MenuEntry[] = [];
    if (!multi && props.onOpenTask) entries.push({ label: "Open", icon: "open", onSelect: () => open(id) });
    entries.push({ label: allDone ? "Reopen" : "Mark Done", icon: "check", onSelect: () => toggleDone(ids) });
    if (props.people && props.people.length > 0) entries.push({ label: "Reassign…", icon: "edit", onSelect: () => reassignMenu(ids, x, y, multi ? null : t.who) });
    if (!multi && !t.milestone) entries.push({ label: t.status === "review" ? "Cancel Review" : "Request Review", icon: "eye", onSelect: () => doStatus(ids, t.status === "review" ? "doing" : "review") });
    if (!multi && t.milestone) entries.push({ label: t.fixed ? "Unpin Date" : "Pin Date", icon: "flag", onSelect: () => commit(items.map((q) => (q.id === id ? { ...q, fixed: !q.fixed } : q)), `${t.title} ${t.fixed ? "can move again" : `is pinned to ${fmtDay(t.s)}`}`) });
    if (props.onDelete) entries.push({ separator: true } as MenuEntry, { label: multi ? `Delete ${ids.length} Tasks` : "Delete", icon: "trash", danger: true, onSelect: () => props.onDelete?.(ids) });
    menu.show(entries, x, y, "context", { label: t.title });
  };
  const reassignMenu = (ids: readonly string[], x: number, y: number, current: PlanWho | null): void => {
    const entries: MenuEntry[] = [{ label: "Unassign", checked: current === null, onSelect: () => { const r = reassign(items, ids, null); if (r) commit(r.items, r.text); } }];
    for (const p of props.people ?? []) entries.push({ label: p.name, checked: current?.name === p.name && current.kind === p.kind, onSelect: () => { const r = reassign(items, ids, p); if (r) commit(r.items, r.text); } });
    menu.show(entries, x, y, "other", { label: "Assign" });
  };
  const filterMenu = (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ head: "Show only" }];
    for (const k of ["all", "wait", "late"] as const) entries.push({ label: FILTER_LABEL[k], checked: filter === k, onSelect: () => { setFilter(k); setSel(new Set()); } });
    menu.show(entries, x, y, "other", { label: "Show only" });
  };

  /* ---------- drag ---------- */
  const onPointerDown = (e: EventLike, id: string, mode: DragMode): void => {
    if (e.button !== 0) return;
    const mod = e.metaKey || e.ctrlKey;
    let deferred = false;
    if (mode !== "mv") only(id);
    else if (mod || e.shiftKey) select(id, mod, e.shiftKey);
    else if (!sel.has(id)) only(id);
    else deferred = true;
    drag.current = { mode, id, ids: mode === "mv" ? (sel.has(id) ? [...sel] : [id]) : [id], x0: e.clientX, y0: e.clientY, dw: g.dw, moved: false, deferred };
    e.preventDefault();
    box.current?.focus({ preventScroll: true });
    const move = (ev: EventLike): void => {
      const D = drag.current;
      if (!D) return;
      const dx = ev.clientX - D.x0, dy = ev.clientY - D.y0;
      if (!D.moved && Math.hypot(dx, dy) < 4) return;
      D.moved = true;
      const ch = dragChanges(items, D.mode, D.id, D.ids, Math.round(dx / D.dw));
      const t: Record<string, { s: number; e: number }> = {};
      for (const c of ch) t[c.id] = { s: c.s, e: c.e };
      setTmp(t);
    };
    const up = (ev: EventLike): void => {
      win().removeEventListener("pointermove", move);
      const D = drag.current;
      drag.current = null;
      setTmp(null);
      if (!D) return;
      if (!D.moved) { if (D.deferred) only(D.id); return; }
      doMoves(dragChanges(items, D.mode, D.id, D.ids, Math.round((ev.clientX - D.x0) / D.dw)));
    };
    win().addEventListener("pointermove", move);
    win().addEventListener("pointerup", up, { once: true });
  };

  /* ---------- keyboard ---------- */
  const onKeyDown = (e: EventLike): void => {
    const target = e.target;
    if (target.closest("input,textarea,[contenteditable=true]")) return;
    const k = e.key ?? "", mod = e.metaKey || e.ctrlKey;
    const stop = (): void => { e.preventDefault(); e.stopPropagation(); };
    if (mod && !e.shiftKey && k.toLowerCase() === "z") { if (undoLast()) stop(); return; }
    if (items.length === 0) return;
    if (mod && k.toLowerCase() === "a") { setSel(new Set(order)); setAnchor(order[0] ?? null); setCur(order[order.length - 1] ?? null); stop(); return; }
    if (k === "Escape" && sel.size > 0) { setSel(new Set()); setCur(null); stop(); return; }
    if (mod && (k === "Backspace" || k === "Delete")) { if (sel.size > 0) props.onDelete?.([...sel]); stop(); return; }
    if ((k === "Enter" || k === " ") && cur && !target.closest("button")) { open(cur); stop(); return; }
    if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight") && sel.size > 0) {
      const d = (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1);
      doMoves(nudgeChanges(items, [...sel], d, mod));
      stop();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k) || mod || e.altKey) return;
    const to = arrowTarget(items, order, cur, k);
    if (to === null) return;
    if (e.shiftKey && anchor !== null && order.includes(anchor)) { const a = order.indexOf(anchor), b = order.indexOf(to); setSel(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))); setCur(to); } else only(to);
    stop();
  };

  if (!web) return <NativeList items={items} />;

  /* ---------- the chart ---------- */
  const { d0, d1, dw, cw } = g;
  const total = LABEL_W + cw + 24;
  const tx = LABEL_W + (today - d0 + 0.5) * dw;
  const pending = slips.filter((s) => s.status === "pending");
  const pos: Record<string, { x1: number; x2: number; yc: number }> = {};
  const labels: ReactNode[] = [];
  const bars: ReactNode[] = [];
  for (const r of lay.rows) {
    if (r.stage) {
      const col = collapsed[r.stage.id] === true;
      const all = r.stage.all.map(eff);
      const tn = all.filter((x) => !x.milestone).length, dn = all.filter((x) => !x.milestone && x.status === "done").length;
      labels.push(h("div", { key: `sl-${r.stage.id}`, style: { position: "absolute", top: r.y, height: r.h, left: 0, width: LABEL_W, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", boxSizing: "border-box" } },
        h("button", { type: "button", "aria-expanded": !col, "data-testid": `plan-stage-${r.stage.id}`, onClick: () => setCollapsed({ ...collapsed, [r.stage!.id]: !col }), style: { ...RESET, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, fontSize: 12.5, color: "var(--ink)" } },
          h("span", { style: { display: "inline-flex", transform: col ? "rotate(-90deg)" : "none" }, dangerouslySetInnerHTML: { __html: ICON.chev } }), r.stage.name),
        h("span", { style: { marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, `${dn}/${tn}`)));
      bars.push(h("div", { key: `sb-${r.stage.id}`, style: { position: "absolute", top: r.y, height: r.h, left: 0, right: 0, background: "color-mix(in srgb, var(--sunk) 55%, transparent)" } }));
      if (all.length > 0) {
        const s = Math.min(...all.map((x) => x.s)), e = Math.max(...all.map((x) => x.e));
        bars.push(h("div", { key: `sp-${r.stage.id}`, style: { position: "absolute", top: r.y + 13, left: LABEL_W + (s - d0) * dw + 1, width: (e - s + 1) * dw - 2, height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" } },
          h("i", { style: { display: "block", height: "100%", width: `${tn ? Math.round((100 * dn) / tn) : 0}%`, background: "var(--ok)" } })));
      }
      continue;
    }
    const it = r.item as Item;
    const f = eff(it);
    const on = sel.has(it.id);
    const x = (f.s - d0) * dw, w = (f.e - f.s + 1) * dw;
    const late = isLate(f, today);
    labels.push(h("div", {
      key: `il-${it.id}`, role: "row", "aria-selected": on, "data-testid": `plan-row-${it.id}`, title: it.title,
      onClick: (e: EventLike) => select(it.id, e.metaKey || e.ctrlKey, e.shiftKey), onDoubleClick: () => open(it.id),
      ...menuTrigger((x: number, y: number) => openMenu(it.id, x, y)),
      style: { position: "absolute", top: r.y, height: r.h, left: 0, width: LABEL_W, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 22px", boxSizing: "border-box", cursor: "default", background: on ? "var(--hover)" : "transparent" },
    }, it.milestone ? icon(ICON.diamond) : h(StatusMark, { status: it.status }), h("span", { style: { fontSize: 13, color: it.status === "done" ? "var(--ink-3)" : "var(--ink)", textDecoration: it.status === "done" ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.title)));
    if (it.milestone) {
      const cx = LABEL_W + (f.s - d0 + 0.5) * dw;
      pos[it.id] = { x1: cx - 8, x2: cx + 8, yc: r.y + ROW_H / 2 };
      bars.push(h("div", {
        key: `ms-${it.id}`, role: "button", "aria-pressed": on, tabIndex: -1, "data-testid": `plan-bar-${it.id}`, title: `${it.title} · ${fmtDay(f.s)}${it.fixed ? " · pinned" : ""}`,
        onPointerDown: (e: EventLike) => onPointerDown(e, it.id, "mv"), onDoubleClick: () => open(it.id), ...menuTrigger((x: number, y: number) => openMenu(it.id, x, y)),
        style: { position: "absolute", left: cx - 9, top: r.y + 9, width: 18, height: 18, cursor: it.fixed ? "default" : "grab", color: it.status === "done" ? "var(--ok)" : on ? "var(--accent)" : "var(--ink-2)" },
      }, h("span", { style: { display: "block", transform: "rotate(45deg) scale(.82)", width: 18, height: 18, border: "2px solid currentColor", borderRadius: 3, boxSizing: "border-box", background: it.status === "done" ? "currentColor" : "var(--win)" } })));
      bars.push(h("span", { key: `msl-${it.id}`, style: { position: "absolute", left: cx + 15, top: r.y + 9, fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap", display: "inline-flex", gap: 6, alignItems: "center" } }, it.title, h("em", { style: { fontStyle: "normal", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, `${fmtWeekday(f.s)} ${fmtDay(f.s)}`), it.fixed ? icon(ICON.pin) : null));
      continue;
    }
    const paint = BAR[it.status];
    const ring = it.status === "review" || it.status === "approval";
    pos[it.id] = { x1: LABEL_W + x + 1, x2: LABEL_W + x + w - 1, yc: r.y + ROW_H / 2 };
    const moving = tmp !== null && tmp[it.id] !== undefined;
    bars.push(h("div", {
      key: `bar-${it.id}`, role: "button", "aria-pressed": on, "aria-label": `${it.title}, ${f.s === f.e ? fmtDay(f.s) : `${fmtDay(f.s)} to ${fmtDay(f.e)}`}${it.who ? `, ${it.who.name}` : ""}`, tabIndex: -1, "data-testid": `plan-bar-${it.id}`, "data-status": it.status,
      title: `${it.title} · ${it.who ? `${it.who.name} · ` : ""}${f.s === f.e ? fmtDay(f.s) : `${fmtDay(f.s)} to ${fmtDay(f.e)}`}`,
      onPointerDown: (e: EventLike) => { const t = e.target; onPointerDown(e, it.id, t.closest("[data-h=s]") ? "rs" : t.closest("[data-h=e]") ? "re" : "mv"); },
      onDoubleClick: () => open(it.id), ...menuTrigger((x: number, y: number) => openMenu(it.id, x, y)),
      style: { position: "absolute", left: LABEL_W + x + 1, top: r.y + 7, width: w - 2, height: 22, boxSizing: "border-box", borderRadius: 7, background: paint.bg, border: `1px solid ${late ? "var(--danger)" : on ? "var(--accent)" : paint.line}`, boxShadow: on ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)" : moving ? "0 4px 10px rgba(0,0,0,.18)" : "none", display: "flex", alignItems: "center", gap: 4, padding: "0 4px", cursor: "grab", overflow: "hidden", touchAction: "none" },
    },
    h("i", { "data-h": "s", style: HANDLE_L }),
    it.who ? h("span", { style: { display: "inline-flex", borderRadius: 99, boxShadow: ring ? "0 0 0 2px var(--accent)" : "none", flex: "none" } }, h(Face, { who: it.who, size: 16 })) : h("span", { style: { width: 16, height: 16, borderRadius: 99, border: "1.5px dashed var(--ink-4)", flex: "none", boxSizing: "border-box" } }),
    w >= 120 ? h("span", { style: { fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.title) : null,
    h("i", { "data-h": "e", style: HANDLE_R })));
    if (w < 120) bars.push(h("span", { key: `bt-${it.id}`, style: { position: "absolute", left: LABEL_W + x + w + 18, top: r.y + 9, fontSize: 12.5, color: it.status === "done" ? "var(--ink-3)" : "var(--ink-2)", whiteSpace: "nowrap" } }, it.title));
  }
  const grid: ReactNode[] = [];
  const heads: ReactNode[] = [];
  const months: ReactNode[] = [];
  const segs: { d: number; m: number }[] = [];
  for (let d = d0; d <= d1; d++) {
    const x = (d - d0) * dw;
    if (isWeekend(d)) grid.push(h("i", { key: `we-${d}`, style: { position: "absolute", left: LABEL_W + x, width: dw, top: 0, bottom: 0, background: "color-mix(in srgb, var(--sunk) 60%, transparent)" } }));
    if (dayOfMonth(d) === 1) grid.push(h("i", { key: `vl-${d}`, style: { position: "absolute", left: LABEL_W + x, top: 0, bottom: 0, width: 1, background: "var(--line)" } }));
    if (d === d0 || dayOfMonth(d) === 1) segs.push({ d, m: monthOf(d) });
    heads.push(h("span", { key: `dc-${d}`, style: { position: "absolute", top: 22, left: LABEL_W + x, width: dw, height: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: d === today ? "var(--accent)" : isWeekend(d) ? "var(--ink-4)" : "var(--ink-3)", fontWeight: d === today ? 700 : 500, lineHeight: 1.15 } }, h("em", { style: { fontStyle: "normal" } }, "SMTWTFS"[weekday(d)]), h("b", { style: { fontWeight: "inherit", fontVariantNumeric: "tabular-nums" } }, dayOfMonth(d))));
  }
  segs.forEach((sg, i) => {
    const e = i + 1 < segs.length ? (segs[i + 1] as { d: number }).d : d1 + 1;
    months.push(h("div", { key: `ms-${sg.d}`, style: { position: "absolute", top: 0, left: LABEL_W + (sg.d - d0) * dw, width: (e - sg.d) * dw, height: 22, display: "flex", alignItems: "center", paddingLeft: 6, fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", overflow: "hidden", whiteSpace: "nowrap" } }, (e - sg.d) * dw < 90 ? MON[sg.m] : MONL[sg.m]));
  });
  const arrows: ReactNode[] = [];
  for (const y2 of shown) {
    for (const dId of y2.deps) {
      const a = pos[dId], b = pos[y2.id];
      if (!a || !b) continue;
      const da = shown.find((q) => q.id === dId) as Item;
      const conflict = y2.s < da.e + (da.milestone || y2.milestone ? 0 : 1) && y2.status !== "done";
      const x1 = a.x2, y1 = a.yc, x2 = b.x1, yb = b.yc;
      const pts: [number, number][] = x2 >= x1 + 16 ? [[x1, y1], [x1 + 9, y1], [x1 + 9, yb], [x2 - 1, yb]] : (() => { const ym = yb > y1 ? yb - ROW_H / 2 : yb + ROW_H / 2; return [[x1, y1], [x1 + 9, y1], [x1 + 9, ym], [x2 - 11, ym], [x2 - 11, yb], [x2 - 1, yb]]; })();
      const hi = sel.has(dId) || sel.has(y2.id);
      const stroke = conflict ? "var(--danger)" : hi ? "var(--accent)" : "var(--ink-4)";
      arrows.push(h("g", { key: `dep-${dId}-${y2.id}`, "data-dep": `${dId}>${y2.id}` }, h("path", { d: roundedPath(pts, 5), fill: "none", stroke, strokeWidth: hi || conflict ? 1.8 : 1.3 }), h("path", { d: `M${x2} ${yb}l-5.5 -3.2v6.4z`, fill: stroke })));
    }
  }
  const ghosts: ReactNode[] = [];
  for (const s of pending) for (const m of s.moves) { const y = lay.ypos[m.id]; if (y !== undefined) ghosts.push(h("div", { key: `gh-${s.id}-${m.id}`, style: { position: "absolute", left: LABEL_W + (m.s - d0) * dw + 1, top: y + 7, width: (m.e - m.s + 1) * dw - 2, height: 22, borderRadius: 7, border: "1.5px dashed var(--ink-4)", boxSizing: "border-box", pointerEvents: "none" } })); }

  const slipCards: ReactElement[] = [];
  for (const s of pending) {
    const cz = items.find((x) => x.id === s.cause);
    const n = s.moves.length;
    slipCards.push(h("div", { key: s.id, "data-testid": "plan-slip", role: "status", style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", margin: "0 0 8px", borderRadius: 10, background: "var(--sunk)", fontSize: 12.5, color: "var(--ink)" } },
      h("span", { style: { flex: 1 } }, h("b", null, `${cz?.title ?? "A task"} slipped ${Math.abs(s.days)} ${Math.abs(s.days) === 1 ? "day" : "days"}`), `. ${n === 0 ? "Nothing else moves" : `${n} later ${n === 1 ? "task moves" : "tasks move"}`}${s.violated.length ? `; ${s.violated.length} pinned ${s.violated.length === 1 ? "date holds" : "dates hold"}` : ""}.`),
      h("button", { type: "button", "data-testid": "plan-slip-apply", onClick: () => applySlip(s), style: { ...BTN, color: "var(--accent-ink)", background: "var(--accent)" } }, n === 0 ? "OK" : "Move them"),
      h("button", { type: "button", "data-testid": "plan-slip-keep", onClick: () => keepSlip(s), style: BTN }, "Keep dates")));
  }

  const tip = (() => {
    const D = drag.current;
    if (!tmp || !D || !D.moved) return null;
    const f = shown.find((q) => q.id === D.id);
    const y = lay.ypos[D.id];
    if (!f || y === undefined) return null;
    return h("div", { style: { position: "absolute", left: LABEL_W + (f.s - d0) * dw, top: y - 4, padding: "2px 6px", borderRadius: 5, background: "var(--ink)", color: "var(--win)", fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none", fontVariantNumeric: "tabular-nums" } }, f.s === f.e ? fmtDay(f.s) : `${fmtDay(f.s)} to ${fmtDay(f.e)}`);
  })();

  const scrollToday = (): void => { scroller.current?.scrollTo({ left: Math.max(0, (today - d0) * dw - 150), behavior: "smooth" }); };
  const height = props.height ?? 340;

  return (
    <View testID={props.testID ?? "plan"}>
      {h("div", {
        ref: box, tabIndex: 0, role: "application", "aria-label": "Plan", onKeyDown, "data-testid": "plan-root",
        style: { outline: "none", display: "flex", flexDirection: "column", minWidth: 0, color: "var(--ink)" } as CSSProperties,
      },
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "2px 0 8px" } },
        h("button", { type: "button", "aria-label": "Filter tasks", title: "Show only…", "data-testid": "plan-filter", onClick: (e: EventLike) => { const r = e.currentTarget.getBoundingClientRect(); filterMenu(r.left, r.bottom + 4); }, style: { ...RESET, display: "inline-flex", padding: 5, borderRadius: 6, color: filter === "all" ? "var(--ink-3)" : "var(--accent)" }, dangerouslySetInnerHTML: { __html: ICON.filter } }),
        filter !== "all" ? h("span", { style: { fontSize: 12, color: "var(--ink-3)" } }, `${FILTER_LABEL[filter]} · `, h("button", { type: "button", onClick: () => setFilter("all"), style: { ...RESET, color: "var(--accent)", fontSize: 12 } }, "Show all")) : null,
        sel.size > 1 ? h("span", { style: { fontSize: 12, color: "var(--ink-2)" } }, `${sel.size} selected`) : null,
        h("span", { style: { flex: 1 } }),
        h("span", { title: "A ring on a face means a review or approval is waiting", style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" } }, h("i", { style: { width: 10, height: 10, borderRadius: 99, boxShadow: "0 0 0 2px var(--accent)", display: "inline-block" } }), "Waiting on review"),
        h("button", { type: "button", "data-testid": "plan-today", onClick: scrollToday, style: BTN }, "Today")),
      ...slipCards,
      h("div", { ref: scroller, "data-testid": "plan-scroll", style: { position: "relative", overflow: "auto", height, border: "1px solid var(--line)", borderRadius: 10, background: "var(--win)" } },
        h("div", { style: { position: "relative", width: total, height: lay.height + HEAD_H + 2 } },
          h("div", { style: { position: "sticky", top: 0, zIndex: 5, height: HEAD_H, width: total, background: "var(--win)", borderBottom: "1px solid var(--line)" } },
            ...months, ...heads,
            h("span", { style: { position: "absolute", left: tx - 18, top: 4, width: 36, textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "var(--accent-ink)", background: "var(--accent)", borderRadius: 5, lineHeight: "15px", zIndex: 2 } }, "Today")),
          h("div", { style: { position: "absolute", top: HEAD_H, left: 0, width: total, height: lay.height } },
            ...grid, ...bars,
            h("i", { style: { position: "absolute", left: tx, top: 0, bottom: 0, width: 2, marginLeft: -1, background: "var(--accent)", opacity: 0.7, pointerEvents: "none" } }),
            ...ghosts,
            h("svg", { width: total, height: lay.height, style: { position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" } }, ...arrows),
            tip),
          h("div", { style: { position: "sticky", left: 0, top: 0, width: LABEL_W, height: 0, zIndex: 6 } },
            h("div", { style: { position: "absolute", left: 0, top: HEAD_H, width: LABEL_W, height: lay.height, background: "var(--win)", borderRight: "1px solid var(--line)" } }, ...labels)))),
      line ? h("div", { role: "status", "data-testid": "plan-line", style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 2px 0", fontSize: 12.5, color: "var(--ink-2)" } }, line, undo.length > 0 ? h("button", { type: "button", "data-testid": "plan-undo", onClick: () => { undoLast(); }, style: { ...RESET, color: "var(--accent)", fontSize: 12.5 } }, "Undo") : null) : null)}
      {menu.element}
    </View>
  );
}

const RESET: CSSProperties = { border: 0, background: "none", padding: 0, margin: 0, font: "inherit", cursor: "pointer" };
const BTN: CSSProperties = { border: "1px solid var(--line)", background: "var(--raised)", color: "var(--ink)", borderRadius: 7, padding: "3px 10px", fontSize: 12, cursor: "pointer", font: "inherit" };
const HANDLE_L: CSSProperties = { position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" };
const HANDLE_R: CSSProperties = { position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" };

/** Native has no chart yet: the tasks as a plain list in start order. */
function NativeList({ items }: { items: readonly Item[] }): ReactElement {
  const sorted = [...items].sort((a, b) => a.s - b.s);
  const lines: ReactElement[] = [];
  for (const i of sorted) lines.push(<Text key={i.id}>{`${i.title}  ${fmtDay(i.s)}${i.e === i.s ? "" : ` to ${fmtDay(i.e)}`}`}</Text>);
  return <View testID="plan-native">{lines}</View>;
}

export { cascade };
