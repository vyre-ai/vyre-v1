// ui/Plan: the one Plan component (the prototype's VyreUI.plan): the tasks of a project, a Journey, a record or Home My work as a Timeline, a Board, a List or a Calendar.
// Timeline: bars from start to end, diamonds for milestones, a line for today, arrows for what waits on what (drag a selected bar's dot onto another task to link them; right-click an arrow to remove it).
// Drag a bar to move it or its ends to resize; Alt-arrows nudge; a slip that pushes later tasks asks to move them or keep their dates. Board: drag a card to another stage.
// List: click a face to change who, or the reviewer. Calendar: drag a bar by days and weeks. Right-click opens the shared Menu; the new-task name is typed where the task appears.
// Web draws the chart with DOM; native lists the tasks (no drag there yet). Colours are skin tokens (CSS variables), so a skin switch repaints with no re-render.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Text, View } from "react-native";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { boardView } from "./board.tsx";
import { calendarView } from "./calendar.tsx";
import { DatePicker } from "./datepicker.tsx";
import type { PickerState } from "./datepicker.tsx";
import { listView } from "./list.tsx";
import {
  FILTER_LABEL, LABEL_W, ROW_H, applyMoves, applySlipMoves, arrowTarget, blankTask, clickSelect, dragChanges, dueChanges, fmtDay, geomOf, itemOf, layoutOf, linkItems, monthOf, moveToStage, nudgeChanges, orderOf, passes,
  reassign, removeItems, setStatus, slipText, taskOf, toDay, unlinkItems,
} from "./logic.ts";
import type { Change, DragMode, Item, PlanFilter, Slip, WhoSlot } from "./logic.ts";
import { BTN, BTN_PRIMARY, ICON, RESET, h, icon, win } from "./parts.tsx";
import type { ElLike, EventLike, PlanCtx } from "./parts.tsx";
import { timelineView } from "./timeline.tsx";
import type { PlanProps, PlanStatus, PlanTask, PlanView, PlanWho } from "./types.ts";

export type { PlanProps, PlanStage, PlanStatus, PlanTask, PlanView, PlanWho } from "./types.ts";
export * from "./logic.ts";
export { roundedPath } from "./timeline.tsx";
export { DatePicker } from "./datepicker.tsx";

const web = Platform.OS === "web";
const VIEWS: readonly PlanView[] = ["timeline", "board", "list", "calendar"];
const VIEW_LABEL: Record<PlanView, string> = { timeline: "Timeline", board: "Board", list: "List", calendar: "Calendar" };

interface Snapshot { text: string; items: Item[]; slips: Slip[] }
interface DragState { mode: DragMode | "link" | "cal"; id: string; ids: string[]; x0: number; y0: number; dw: number; cw: number; rh: number; moved: boolean; deferred: boolean; src: { x: number; y: number } }

let uidn = 0;
const uid = (): string => `s${++uidn}`;

/** The remembered view of a Plan (browser storage; never required). */
export function readView(key: string | undefined): PlanView | null {
  if (!key) return null;
  try {
    const v = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage?.getItem(`vyre-ui:plan:${key}:view`) ?? null;
    return VIEWS.includes(v as PlanView) ? (v as PlanView) : null;
  } catch { return null; }
}
export function writeView(key: string | undefined, v: PlanView): void {
  if (!key) return;
  try { (globalThis as { localStorage?: { setItem(k: string, v: string): void } }).localStorage?.setItem(`vyre-ui:plan:${key}:view`, v); } catch { /* storage may be blocked */ }
}

export function Plan(props: PlanProps): ReactElement {
  const today = toDay(props.today);
  const raw = useRef<Map<string, PlanTask>>(new Map());
  const [items, setItems] = useState<Item[]>(() => props.tasks.map(itemOf));
  const [view, setViewState] = useState<PlanView>(() => props.view ?? readView(props.viewKey) ?? "timeline");
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<PlanFilter>("all");
  const [slips, setSlips] = useState<Slip[]>([]);
  const [undo, setUndo] = useState<Snapshot[]>([]);
  const [line, setLine] = useState<string | null>(null);
  const [tmp, setTmp] = useState<Record<string, { s: number; e: number }> | null>(null);
  const [band, setBand] = useState<PlanCtx["band"]>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState<number>(monthOf(today));
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [width, setWidth] = useState(900);
  const drag = useRef<DragState | null>(null);
  const cards = useRef<string[]>([]);
  const namingRef = useRef<string | null>(null);
  const box = useRef<ElLike | null>(null);
  const scroller = useRef<ElLike | null>(null);
  const body = useRef<ElLike | null>(null);
  const menu = useMenu();
  const canAdd = props.canAdd !== false;
  const canDelete = props.canDelete !== false;

  useEffect(() => { raw.current = new Map(props.tasks.map((t) => [t.id, t])); setItems(props.tasks.map(itemOf)); }, [props.tasks]);
  useEffect(() => {
    if (!web) return;
    const measure = (): void => { const w = box.current?.clientWidth; if (w) setWidth(w); };
    measure();
    win().addEventListener("resize", measure);
    return () => win().removeEventListener("resize", measure);
  }, []);

  const shown = useMemo(() => items.map((i) => (tmp && tmp[i.id] ? { ...i, ...(tmp[i.id] as { s: number; e: number }) } : i)), [items, tmp]);
  const lay = useMemo(() => layoutOf(props.stages, shown, collapsed, filter, today), [props.stages, shown, collapsed, filter, today]);
  /** The order the keyboard walks, per view. */
  const order = useMemo(() => {
    if (view === "calendar") return shown.filter((x) => passes(x, filter, today)).sort((a, b) => a.s - b.s || a.e - b.e).map((x) => x.id);
    if (view === "board") return props.stages.flatMap((st) => shown.filter((x) => x.stage === st.id && passes(x, filter, today)).sort((a, b) => a.s - b.s || a.e - b.e).map((x) => x.id));
    return orderOf(lay);
  }, [view, shown, filter, today, props.stages, lay]);

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
    setUndo(undo.slice(0, -1)); setItems(s.items); setSlips(s.slips); setLine(null); setNaming(null); namingRef.current = null;
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
  const applySlip = (s: Slip): void => { const r = applySlipMoves(items, s); commit(r.items, r.text, slips.filter((x) => x.id !== s.id)); };
  const keepSlip = (s: Slip): void => {
    const cz = items.find((x) => x.id === s.cause);
    setUndo((u) => [...u.slice(-39), { text: "Kept the dates", items, slips }]);
    setSlips(slips.filter((x) => x.id !== s.id));
    setLine(`Kept the dates; ${cz ? cz.title : "the task"} now overlaps what follows`);
  };
  const removeSel = (ids: readonly string[]): void => { const r = removeItems(items, ids); if (r) { setSel(new Set()); setCur(null); commit(r.items, r.text, slips.filter((s) => r.items.some((x) => x.id === s.cause))); } };
  const doLink = (a: string, b: string): void => {
    const r = linkItems(items, a, b, uid);
    if (!r) { setLine(a === b ? "A task cannot follow itself" : "That link would make a loop, or it exists already"); return; }
    commit(r.items, r.text, r.slip ? [r.slip, ...slips] : slips);
  };

  const open = (id: string): void => { const t = items.find((x) => x.id === id); if (t && props.onOpenTask) props.onOpenTask(taskOf(t, raw.current.get(id))); };
  const select = (id: string, mod: boolean, shift: boolean): void => { const r = clickSelect(order, sel, anchor, id, mod, shift); setSel(r.sel); setAnchor(r.anchor); setCur(r.cur); };
  const only = (id: string): void => { setSel(new Set([id])); setAnchor(id); setCur(id); };
  const setView = (v: PlanView): void => { setViewState(v); writeView(props.viewKey, v); props.onViewChange?.(v); };

  /* ---------- adding and naming ---------- */
  const add = (stageId: string | null): void => {
    if (props.onCreate) { props.onCreate(stageId); return; }
    const t = props.onAddTask?.(stageId) ?? blankTask(stageId ?? props.stages[0]?.id ?? "", today, uid());
    const it = itemOf(t);
    setUndo((u) => [...u.slice(-39), { text: `Added ${it.title}`, items, slips }]);
    setItems([...items, it]); only(it.id); setNaming(it.id); namingRef.current = it.id;
  };
  const rename = (id: string, text: string, how: "enter" | "esc" | "tab", anchorEl: ElLike): void => {
    if (namingRef.current !== id) return;
    namingRef.current = null;
    setNaming(null);
    const title = how === "esc" ? "New task" : text.trim() || "New task";
    const next = items.map((x) => (x.id === id ? { ...x, title } : x));
    setItems(next); setLine(`Added ${title}`);
    emit(next, `Added ${title}`);
    if (how === "tab") { const r = anchorEl.getBoundingClientRect(); assignMenu([id], r.left, r.bottom + 4, "who", items.find((x) => x.id === id)?.who ?? null); }
  };

  /* ---------- menus ---------- */
  const assignMenu = (ids: readonly string[], x: number, y: number, slot: WhoSlot, current: PlanWho | null): void => {
    const people = props.people ?? [];
    if (people.length === 0) return;
    const entries: MenuEntry[] = [{ label: slot === "who" ? "Unassign" : "Clear", checked: current === null, onSelect: () => { const r = reassign(items, ids, null, slot); if (r) commit(r.items, r.text); } }, { separator: true } as MenuEntry];
    const groups: { kind: PlanWho["kind"]; head: string }[] = [{ kind: "person", head: "People" }, { kind: "agent", head: "Agents" }, { kind: "group", head: "Groups" }, { kind: "role", head: "Roles" }];
    for (const gr of groups) {
      const list = people.filter((p) => p.kind === gr.kind);
      if (list.length === 0) continue;
      entries.push({ head: gr.head });
      for (const p of list) entries.push({ label: p.name, checked: current?.name === p.name && current.kind === p.kind, onSelect: () => { const r = reassign(items, ids, p, slot); if (r) commit(r.items, r.text); } });
    }
    menu.show(entries, x, y, "other", { label: "Assign" });
  };
  const assign = (id: string, anchorEl: ElLike, slot: WhoSlot): void => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const r = anchorEl.getBoundingClientRect();
    assignMenu([id], r.left, r.bottom + 4, slot, slot === "who" ? it.who : slot === "reviewer" ? it.reviewer : it.approver);
  };
  const openMenu = (id: string, x: number, y: number): void => {
    const ids = sel.has(id) && sel.size > 1 ? [...sel] : [id];
    if (!sel.has(id)) only(id);
    const multi = ids.length > 1;
    const t = items.find((i) => i.id === id) as Item;
    const allDone = ids.every((i) => items.find((q) => q.id === i)?.status === "done");
    const entries: MenuEntry[] = [];
    if (!multi && props.onOpenTask) entries.push({ label: "Open", icon: "open", onSelect: () => open(id) });
    entries.push({ label: allDone ? "Reopen" : "Mark Done", icon: "check", onSelect: () => toggleDone(ids) });
    if (!t.fixed) entries.push({ label: multi ? "Due Date…" : t.milestone ? "Date…" : "Due Date…", icon: "clock", onSelect: () => setPicker({ x, y, cur: t.e, ids }) });
    if ((props.people?.length ?? 0) > 0) entries.push({ label: "Reassign…", icon: "edit", onSelect: () => assignMenu(ids, x, y, "who", multi ? null : t.who) });
    if (!multi && !t.milestone) entries.push({ label: t.status === "review" ? "Cancel Review" : "Request Review", icon: "eye", onSelect: () => doStatus(ids, t.status === "review" ? "doing" : "review") });
    if (!multi && t.milestone) entries.push({ label: t.fixed ? "Unpin Date" : "Pin Date", icon: "flag", onSelect: () => commit(items.map((q) => (q.id === id ? { ...q, fixed: !q.fixed } : q)), `${t.title} ${t.fixed ? "can move again" : `is pinned to ${fmtDay(t.s)}`}`) });
    if (canDelete) entries.push({ separator: true } as MenuEntry, { label: multi ? `Delete ${ids.length} Tasks` : "Delete", icon: "trash", danger: true, onSelect: () => removeSel(ids) });
    menu.show(entries, x, y, "context", { label: t.title });
  };
  const linkMenu = (a: string, b: string, x: number, y: number): void => menu.show([{ label: "Remove Link", icon: "minus", danger: true, onSelect: () => { const r = unlinkItems(items, a, b); if (r) commit(r.items, r.text); } }], x, y, "context", { label: "Link" });
  const filterMenu = (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ head: "Show only" }];
    for (const k of ["all", "wait", "late"] as const) entries.push({ label: FILTER_LABEL[k], checked: filter === k, onSelect: () => { setFilter(k); setSel(new Set()); } });
    menu.show(entries, x, y, "other", { label: "Show only" });
  };
  const viewMenu = (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ head: "View" }];
    for (const v of VIEWS) entries.push({ label: VIEW_LABEL[v], checked: view === v, onSelect: () => setView(v) });
    menu.show(entries, x, y, "other", { label: "View" });
  };
  const selWhoMenu = (x: number, y: number): void => assignMenu([...sel], x, y, "who", null);

  /* ---------- drag ---------- */
  const sourcePoint = (id: string): { x: number; y: number } => {
    const g = geomOf(shown, today, width);
    const it = shown.find((x) => x.id === id) as Item;
    const y = (lay.ypos[id] ?? 0) + ROW_H / 2;
    return { x: it.milestone ? LABEL_W + (it.s - g.d0 + 0.5) * g.dw + 8 : LABEL_W + (it.e - g.d0 + 1) * g.dw - 1, y };
  };
  const down = (e: EventLike, id: string, mode: DragMode | "link" | "cal"): void => {
    if (e.button !== 0) return;
    const mod = e.metaKey || e.ctrlKey;
    let deferred = false;
    if (mode === "rs" || mode === "re" || mode === "link") only(id);
    else if (mod || e.shiftKey) select(id, mod, e.shiftKey);
    else if (!sel.has(id)) only(id);
    else deferred = true;
    const wk = mode === "cal" ? e.currentTarget.closest("[data-week]")?.getBoundingClientRect() : undefined;
    const g = geomOf(shown, today, width);
    const D: DragState = { mode, id, ids: mode === "mv" || mode === "cal" ? (sel.has(id) ? [...sel] : [id]) : [id], x0: e.clientX, y0: e.clientY, dw: g.dw, cw: wk ? wk.width / 7 : 1, rh: wk ? wk.height : 1, moved: false, deferred, src: mode === "link" ? sourcePoint(id) : { x: 0, y: 0 } };
    drag.current = D;
    e.preventDefault();
    box.current?.focus({ preventScroll: true });
    const deltaOf = (ev: EventLike): number => (mode === "cal" ? Math.round((ev.clientX - D.x0) / D.cw) + 7 * Math.round((ev.clientY - D.y0) / D.rh) : Math.round((ev.clientX - D.x0) / D.dw));
    const targetAt = (ev: EventLike): string | null => {
      const els = win().document?.elementsFromPoint(ev.clientX, ev.clientY) ?? [];
      for (const el of els) { const hit = el.closest("[data-id]"); const tid = hit?.getAttribute("data-id") ?? null; if (tid && tid !== D.id) return tid; }
      return null;
    };
    const move = (ev: EventLike): void => {
      if (!D.moved && Math.hypot(ev.clientX - D.x0, ev.clientY - D.y0) < 4) return;
      D.moved = true;
      if (mode === "link") {
        const r = body.current?.getBoundingClientRect();
        if (r) setBand({ x1: D.src.x, y1: D.src.y, x2: ev.clientX - r.left, y2: ev.clientY - r.top, target: targetAt(ev) });
        return;
      }
      const ch = dragChanges(items, mode === "cal" ? "mv" : mode, D.id, D.ids, deltaOf(ev));
      const t: Record<string, { s: number; e: number }> = {};
      for (const c of ch) t[c.id] = { s: c.s, e: c.e };
      setTmp(t);
    };
    const up = (ev: EventLike): void => {
      win().removeEventListener("pointermove", move);
      drag.current = null;
      setTmp(null); setBand(null);
      if (!D.moved) { if (D.deferred) only(D.id); return; }
      if (mode === "link") { const t = targetAt(ev); if (t) doLink(D.id, t); return; }
      doMoves(dragChanges(items, mode === "cal" ? "mv" : mode, D.id, D.ids, deltaOf(ev)));
    };
    win().addEventListener("pointermove", move);
    win().addEventListener("pointerup", up, { once: true });
  };

  /* ---------- keyboard ---------- */
  const columnTarget = (key: string): string | null => {
    const cols = props.stages.map((st) => shown.filter((x) => x.stage === st.id && passes(x, filter, today)).sort((a, b) => a.s - b.s || a.e - b.e).map((x) => x.id));
    const ci = cols.findIndex((col) => cur !== null && col.includes(cur));
    if (cur === null || ci < 0) return order[key === "ArrowUp" || key === "ArrowLeft" ? order.length - 1 : 0] ?? null;
    const col = cols[ci] as string[];
    const ri = col.indexOf(cur);
    if (key === "ArrowUp" || key === "ArrowDown") return col[Math.max(0, Math.min(col.length - 1, ri + (key === "ArrowDown" ? 1 : -1)))] ?? cur;
    let j = ci + (key === "ArrowRight" ? 1 : -1);
    while (j >= 0 && j < cols.length && (cols[j] as string[]).length === 0) j += key === "ArrowRight" ? 1 : -1;
    return j >= 0 && j < cols.length ? ((cols[j] as string[])[Math.min(ri, (cols[j] as string[]).length - 1)] ?? cur) : cur;
  };
  const onKeyDown = (e: EventLike): void => {
    const target = e.target;
    if (target.closest("input,textarea,[contenteditable=true]")) return;
    const k = e.key ?? "", mod = e.metaKey || e.ctrlKey;
    const stop = (): void => { e.preventDefault(); e.stopPropagation(); };
    if (mod && !e.shiftKey && k.toLowerCase() === "z") { if (undoLast()) stop(); return; }
    if (items.length === 0) return;
    if (mod && k.toLowerCase() === "a") { setSel(new Set(order)); setAnchor(order[0] ?? null); setCur(order[order.length - 1] ?? null); stop(); return; }
    if (k === "Escape" && sel.size > 0) { setSel(new Set()); setCur(null); stop(); return; }
    if (mod && (k === "Backspace" || k === "Delete")) { if (sel.size > 0 && canDelete) removeSel([...sel]); stop(); return; }
    if ((k === "Enter" || k === " ") && cur && !target.closest("button")) { open(cur); stop(); return; }
    if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight") && sel.size > 0) {
      const d = (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1);
      doMoves(nudgeChanges(items, [...sel], d, mod));
      stop();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k) || mod || e.altKey) return;
    const to = view === "board" ? columnTarget(k) : view === "calendar" ? arrowTarget(items, order, cur, k === "ArrowLeft" || k === "ArrowUp" ? "ArrowUp" : "ArrowDown") : arrowTarget(items, order, cur, k);
    if (to === null) return;
    if (e.shiftKey && anchor !== null && order.includes(anchor)) { const a = order.indexOf(anchor), b = order.indexOf(to); setSel(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))); setCur(to); } else only(to);
    stop();
  };

  if (!web) return <NativeList items={items} />;

  const ctx: PlanCtx = {
    today, width, filter, stages: props.stages, items: shown, sel, cur, collapsed, naming, moving: new Set(tmp ? Object.keys(tmp) : []), slips, canAdd, band, calMonth,
    select, only, open, menu: openMenu, toggleDone, toggleStage: (id) => setCollapsed({ ...collapsed, [id]: !collapsed[id] }), add, down, assign, rename, unlink: (a, b) => { const r = unlinkItems(items, a, b); if (r) commit(r.items, r.text); },
    setCalMonth, cardDragStart: (id) => { cards.current = sel.has(id) ? [...sel] : [id]; },
    cardDrop: (stageId) => { const st = props.stages.find((s) => s.id === stageId); const r = st ? moveToStage(items, cards.current, stageId, st.name) : null; cards.current = []; if (r) commit(r.items, r.text); },
    setScroller: (el) => { scroller.current = el; }, setBody: (el) => { body.current = el; }, linkMenu,
  };
  const height = props.height ?? 340;
  const pending = slips.filter((s) => s.status === "pending" && items.some((x) => x.id === s.cause));
  const slipCards: ReactElement[] = [];
  for (let i = 0; i < pending.length; i++) {
    const s = pending[i] as Slip;
    const t = slipText(items, s);
    const n = s.moves.filter((m) => m.id !== s.cause).length;
    slipCards.push(h("div", { key: s.id, "data-testid": "plan-slip", role: "group", "aria-label": "Schedule proposal", style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", margin: "0 0 8px", borderRadius: 10, background: "var(--sunk)", fontSize: 12.5, color: "var(--ink)" } },
      icon(ICON.clock, { color: "var(--ink-3)", marginTop: 1 }),
      h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { style: { fontWeight: 600 } }, t.title), h("div", { style: { color: "var(--ink-2)" } }, t.body, t.why && i === 0 ? ` ${t.why}` : "")),
      h("button", { type: "button", "data-testid": "plan-slip-apply", onClick: () => applySlip(s), style: BTN_PRIMARY }, n === 0 ? "OK" : "Apply"),
      h("button", { type: "button", "data-testid": "plan-slip-keep", onClick: () => keepSlip(s), style: BTN }, "Keep dates")));
  }
  const scrollToday = (): void => {
    if (view === "calendar") { setCalMonth(monthOf(today)); return; }
    const g = geomOf(shown, today, width);
    scroller.current?.scrollTo({ left: Math.max(0, (today - g.d0) * g.dw - 150), behavior: "smooth" });
  };
  const views: Record<PlanView, ReactElement> = { timeline: timelineView(ctx, height), board: boardView(ctx, height), list: listView(ctx, height), calendar: calendarView(ctx, height) };

  return (
    <View testID={props.testID ?? "plan"}>
      {h("div", { ref: box, tabIndex: 0, role: "application", "aria-label": "Plan", onKeyDown, "data-testid": "plan-root", "data-view": view, style: { outline: "none", display: "flex", flexDirection: "column", minWidth: 0, color: "var(--ink)" } },
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "2px 0 8px" } },
          props.fixedView ? null : h("button", { type: "button", "data-testid": "plan-view", "aria-haspopup": "menu", onClick: (e: EventLike) => { const r = e.currentTarget.getBoundingClientRect(); viewMenu(r.left, r.bottom + 4); }, style: { ...BTN, display: "inline-flex", alignItems: "center", gap: 6 } }, icon(ICON[view]), VIEW_LABEL[view], icon(ICON.chev)),
          h("button", { type: "button", "aria-label": "Filter tasks", title: "Show only…", "data-testid": "plan-filter", onClick: (e: EventLike) => { const r = e.currentTarget.getBoundingClientRect(); filterMenu(r.left, r.bottom + 4); }, style: { ...RESET, display: "inline-flex", padding: 5, borderRadius: 6, color: filter === "all" ? "var(--ink-3)" : "var(--accent)" }, dangerouslySetInnerHTML: { __html: ICON.filter } }),
          filter !== "all" ? h("span", { style: { fontSize: 12, color: "var(--ink-3)" } }, `${FILTER_LABEL[filter]} · `, h("button", { type: "button", onClick: () => setFilter("all"), style: { ...RESET, color: "var(--accent)", fontSize: 12 } }, "Show all")) : null,
          sel.size > 1 ? h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" } }, `${sel.size} selected`,
            h("button", { type: "button", "data-testid": "plan-seldone", onClick: () => toggleDone([...sel]), style: BTN }, "Mark done"),
            (props.people?.length ?? 0) > 0 ? h("button", { type: "button", "data-testid": "plan-selwho", onClick: (e: EventLike) => { const r = e.currentTarget.getBoundingClientRect(); selWhoMenu(r.left, r.bottom + 4); }, style: BTN }, "Reassign") : null,
            canDelete ? h("button", { type: "button", "data-testid": "plan-seldel", onClick: () => removeSel([...sel]), style: { ...BTN, color: "var(--danger)" } }, "Delete") : null) : null,
          h("span", { style: { flex: 1 } }),
          view === "timeline" ? h("span", { title: "A ring on a face means a review or approval is waiting", style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" } }, h("i", { style: { width: 10, height: 10, borderRadius: 99, boxShadow: "0 0 0 2px var(--accent)", display: "inline-block" } }), "Waiting on review") : null,
          view === "timeline" || view === "calendar" ? h("button", { type: "button", "data-testid": "plan-today", onClick: scrollToday, style: BTN }, "Today") : null,
          canAdd ? h("button", { type: "button", "data-testid": "plan-add", onClick: () => add(null), style: { ...BTN, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 } }, icon(ICON.plus), "New task") : null),
        ...slipCards,
        items.length === 0 ? h("div", { "data-testid": "plan-empty", style: { padding: "28px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 } }, "No tasks yet.") : views[view],
        line ? h("div", { role: "status", "data-testid": "plan-line", style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 2px 0", fontSize: 12.5, color: "var(--ink-2)" } }, line, undo.length > 0 ? h("button", { type: "button", "data-testid": "plan-undo", onClick: () => { undoLast(); }, style: { ...RESET, color: "var(--accent)", fontSize: 12.5 } }, "Undo") : null) : null)}
      {menu.element}
      {picker ? <DatePicker at={picker} today={today} onClose={() => setPicker(null)} onPick={(d) => { const ids = picker.ids; setPicker(null); doMoves(dueChanges(items, ids, d)); }} /> : null}
    </View>
  );
}

/** Native has no chart yet: the tasks as a plain list in start order. */
function NativeList({ items }: { items: readonly Item[] }): ReactElement {
  const sorted = [...items].sort((a, b) => a.s - b.s);
  const lines: ReactElement[] = [];
  for (const i of sorted) lines.push(<Text key={i.id}>{`${i.title}  ${fmtDay(i.s)}${i.e === i.s ? "" : ` to ${fmtDay(i.e)}`}`}</Text>);
  return <View testID="plan-native">{lines}</View>;
}

