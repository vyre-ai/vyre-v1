// ui/Plan parts: the small pieces every view shares (DOM element helper, status mark, faces, the inline name field) and the context the views draw from.
// The views are plain functions of a PlanCtx; the component in index.tsx owns the state and the actions.

import { createElement, useEffect, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Avatar } from "../Avatar/index.tsx";
import type { DragMode, Item, PlanFilter, Slip, WhoSlot } from "./logic.ts";
import type { PlanStage, PlanStatus, PlanWho } from "./types.ts";

/** The few DOM members the chart touches (this repo compiles without the DOM lib). */
export interface ElLike {
  clientWidth: number;
  value?: string;
  closest(selector: string): ElLike | null;
  focus(o?: { preventScroll?: boolean }): void;
  select?(): void;
  scrollTo(o: { left: number; behavior?: string }): void;
  scrollIntoView?(o: { block: string; inline?: string }): void;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
  getAttribute(name: string): string | null;
}
export interface EventLike {
  button?: number; clientX: number; clientY: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean; key?: string; isComposing?: boolean;
  target: ElLike; currentTarget: ElLike; preventDefault(): void; stopPropagation(): void;
  dataTransfer?: { effectAllowed: string; setData(t: string, v: string): void };
}
export interface Win {
  addEventListener(t: string, f: (e: EventLike) => void, o?: { once?: boolean }): void;
  removeEventListener(t: string, f: (e: EventLike) => void): void;
  document?: { elementsFromPoint(x: number, y: number): ElLike[] };
}
export const win = (): Win => globalThis as unknown as Win;

/** DOM elements by tag, with loose props: the handlers take the small EventLike above, not the DOM lib's event types. */
export const h = createElement as unknown as (tag: string | ((p: never) => ReactElement), props: Record<string, unknown> | null, ...children: ReactNode[]) => ReactElement;

export const RESET: CSSProperties = { border: 0, background: "none", padding: 0, margin: 0, font: "inherit", color: "inherit", cursor: "pointer" };
export const BTN: CSSProperties = { border: "1px solid var(--line)", background: "var(--raised)", color: "var(--ink)", borderRadius: 7, padding: "3px 10px", fontSize: 12, cursor: "pointer", font: "inherit" };
export const BTN_PRIMARY: CSSProperties = { ...BTN, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-ink)" };

/** Status paints a bar: a wash of the status colour with a line of it, never a filled block. */
// color-mix-ok: bar fills are DOM div backgrounds in the Plan view, not react-native-web styles
const wash = (c: string, pct: number): string => `color-mix(in srgb, var(--${c}) ${pct}%, var(--win))`;
export const BAR: Record<PlanStatus, { bg: string; line: string }> = {
  todo: { bg: "var(--sunk)", line: "var(--ink-4)" },
  doing: { bg: wash("accent", 14), line: "var(--accent)" },
  blocked: { bg: wash("warn", 16), line: "var(--warn)" },
  review: { bg: wash("accent", 10), line: "var(--accent)" },
  approval: { bg: wash("accent", 10), line: "var(--accent)" },
  done: { bg: wash("ok", 14), line: "var(--ok)" },
};

const SVG = (children: string, size = 13): string => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
export const ICON = {
  chev: SVG('<path d="M4 6l4 4 4-4"/>', 12),
  diamond: SVG('<path d="M8 2.5l5 5.5-5 5.5L3 8z"/>', 14),
  filter: SVG('<path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>', 14),
  plus: SVG('<path d="M8 3v10M3 8h10"/>', 13),
  pin: SVG('<path d="M6 2.5h4l-.7 4 2 2.2H4.7l2-2.2zM8 8.7v4.8"/>', 11),
  back: SVG('<path d="M10 3.5L5.5 8l4.5 4.5"/>', 14),
  clock: SVG('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>', 16),
  timeline: SVG('<path d="M2.5 4h6M5.5 8h8M3.5 12h5"/>', 14),
  board: SVG('<path d="M2.5 3.5h3.5v9H2.5zM6.5 3.5H10v6H6.5zM10.5 3.5H14v8h-3.5z"/>', 14),
  list: SVG('<path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5M2.8 4.5h.01M2.8 8h.01M2.8 11.5h.01"/>', 14),
  calendar: SVG('<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>', 14),
  link: SVG('<path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.2 2.2 0 003.1 3.1L8 10.7M11 8.5l1.2-1.2a2.2 2.2 0 00-3.1-3.1L8 5.3"/>', 12),
};
export const icon = (svg: string, style?: CSSProperties): ReactElement => h("span", { style: { display: "inline-flex", ...style }, dangerouslySetInnerHTML: { __html: svg } });

/** The status mark: to do, doing, review or approval (a ring with a tick), blocked, done. */
export function StatusMark({ status, size = 15 }: { status: PlanStatus; size?: number }): ReactElement {
  const ring = status === "done" ? "var(--ok)" : status === "blocked" ? "var(--warn)" : status === "todo" ? "var(--ink-4)" : "var(--accent)";
  const inner = status === "done" ? '<path d="M5 8.2l2.2 2.2L11 6" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : status === "doing" ? '<path d="M8 4.6a3.4 3.4 0 010 6.8z" fill="var(--accent)"/>' : status === "review" || status === "approval" ? '<path d="M5.2 8.2l1.9 1.9L10.9 6" stroke="var(--ink-2)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : status === "blocked" ? '<path d="M5.2 8h5.6" stroke="var(--warn)" stroke-width="1.8" stroke-linecap="round"/>' : "";
  return h("span", { "data-status": status, style: { display: "inline-flex" }, dangerouslySetInnerHTML: { __html: `<svg viewBox="0 0 16 16" width="${size}" height="${size}"><circle cx="8" cy="8" r="${status === "done" ? 7 : 6.2}" fill="${status === "done" ? "var(--ok)" : "none"}" stroke="${status === "done" ? "none" : status === "review" || status === "approval" ? "var(--ink-3)" : ring}" stroke-width="1.5"/>${inner}</svg>` } });
}

export const faceKind = (w: PlanWho): "person" | "agent" | "group" => (w.kind === "agent" ? "agent" : w.kind === "person" ? "person" : "group");
export function Face({ who, size }: { who: PlanWho; size: number }): ReactElement {
  return <Avatar name={who.name} kind={faceKind(who)} size={size} />;
}

/** A face with the review ring when a review or approval is waiting; clicking it asks for another person. Empty: a dashed ring. */
export function FaceButton({ it, size, ctx, slot = "who" }: { it: Item; size: number; ctx: PlanCtx; slot?: WhoSlot }): ReactElement {
  const w = slot === "who" ? it.who : slot === "reviewer" ? it.reviewer : it.approver;
  const ring = slot === "who" && (it.status === "review" || it.status === "approval");
  return h("span", {
    role: "button", "data-assign": it.id, "data-testid": `plan-who-${it.id}`, title: w ? `${w.name} · change` : "Assign",
    onPointerDown: (e: EventLike) => e.stopPropagation(), onClick: (e: EventLike) => { e.stopPropagation(); ctx.assign(it.id, e.currentTarget, slot); },
    style: { display: "inline-flex", flex: "none", borderRadius: 99, cursor: "pointer", boxShadow: ring ? "0 0 0 2px var(--accent)" : "none" },
  }, w ? h(Face, { who: w, size }) : h("span", { style: { width: size, height: size, borderRadius: 99, border: "1.5px dashed var(--ink-4)", boxSizing: "border-box", display: "inline-block" } }));
}

/** The name of a task, or while it is being named, the input: Enter saves, Escape keeps "New task", Tab saves and opens the assignee picker. */
export function NameField({ it, ctx, style }: { it: Item; ctx: PlanCtx; style?: CSSProperties }): ReactElement {
  const ref = useRef<ElLike | null>(null);
  const on = ctx.naming === it.id;
  useEffect(() => { if (on) { ref.current?.focus(); ref.current?.select?.(); ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } }, [on]);
  if (!on) return h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: it.status === "done" ? "line-through" : "none", color: it.status === "done" ? "var(--ink-3)" : "var(--ink)", ...style } }, it.title);
  return h("input", {
    ref, defaultValue: it.title, "aria-label": "Task name", spellCheck: false, "data-testid": "plan-name",
    onKeyDown: (e: EventLike) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); ctx.rename(it.id, e.target.value ?? "", "enter", e.target); }
      else if (e.key === "Escape") { e.preventDefault(); ctx.rename(it.id, "", "esc", e.target); }
      else if (e.key === "Tab") { e.preventDefault(); ctx.rename(it.id, e.target.value ?? "", "tab", e.target); }
    },
    onBlur: (e: EventLike) => ctx.rename(it.id, e.target.value ?? "", "enter", e.target),
    onPointerDown: (e: EventLike) => e.stopPropagation(), onClick: (e: EventLike) => e.stopPropagation(), onDoubleClick: (e: EventLike) => e.stopPropagation(),
    style: { width: "100%", minWidth: 0, font: "inherit", color: "inherit", background: "var(--win)", border: "1.5px solid var(--accent)", borderRadius: 5, padding: "1px 5px", outline: "none", boxSizing: "border-box" },
  });
}

/** Everything a view reads and every action it can start; the component in index.tsx builds it. */
export interface PlanCtx {
  today: number;
  width: number;
  filter: PlanFilter;
  stages: readonly PlanStage[];
  /** The tasks as drawn: a drag in progress is already applied. */
  items: Item[];
  sel: ReadonlySet<string>;
  cur: string | null;
  collapsed: Readonly<Record<string, boolean>>;
  naming: string | null;
  moving: ReadonlySet<string>;
  slips: readonly Slip[];
  canAdd: boolean;
  /** A rubber band from a task's link handle to the pointer, in chart pixels. */
  band: { x1: number; y1: number; x2: number; y2: number; target: string | null } | null;
  calMonth: number;
  select(id: string, mod: boolean, shift: boolean): void;
  only(id: string): void;
  open(id: string): void;
  menu(id: string, x: number, y: number): void;
  toggleDone(ids: readonly string[]): void;
  toggleStage(id: string): void;
  add(stageId: string | null): void;
  down(e: EventLike, id: string, mode: DragMode | "link" | "cal"): void;
  assign(id: string, anchor: ElLike, slot: WhoSlot): void;
  rename(id: string, text: string, how: "enter" | "esc" | "tab", anchor: ElLike): void;
  unlink(a: string, b: string): void;
  setCalMonth(m: number): void;
  cardDragStart(id: string): void;
  cardDrop(stageId: string): void;
  setScroller(el: ElLike | null): void;
  setBody(el: ElLike | null): void;
  /** Right-click on a dependency arrow: Remove Link. */
  linkMenu(a: string, b: string, x: number, y: number): void;
}
