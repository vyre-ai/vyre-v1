// ui/Plan calendar view: a month, Monday first. Tasks are bars across the days they cover, milestones a diamond; drag a bar to move it by days and weeks.
import type { ReactElement, ReactNode } from "react";
import { menuTrigger } from "../Menu/index.tsx";
import { MONL, calendarWeeks, isLate, passes } from "./logic.ts";
import type { CalSeg } from "./logic.ts";
import { BAR, FaceButton, ICON, NameField, h, icon } from "./parts.tsx";
import type { EventLike, PlanCtx } from "./parts.tsx";

function bar(c: PlanCtx, sg: CalSeg): ReactElement {
  const it = sg.item, on = c.sel.has(it.id), paint = BAR[it.status];
  return h("div", {
    key: `${it.id}-${sg.col}`, role: "button", "aria-pressed": on, tabIndex: -1, "data-testid": `plan-cal-${it.id}`, "data-id": it.id, title: it.title,
    onPointerDown: (e: EventLike) => c.down(e, it.id, "cal"), onDoubleClick: () => c.open(it.id), ...menuTrigger((x: number, y: number) => c.menu(it.id, x, y)),
    style: {
      gridColumn: `${sg.col + 1} / span ${sg.len}`, gridRow: sg.lane + 1, display: "flex", alignItems: "center", gap: 4, margin: "1px 2px", padding: "0 5px", height: 22, minWidth: 0, fontSize: 12, cursor: "grab", boxSizing: "border-box", touchAction: "none",
      borderRadius: `${sg.contLeft ? 0 : 6}px ${sg.contRight ? 0 : 6}px ${sg.contRight ? 0 : 6}px ${sg.contLeft ? 0 : 6}px`,
      background: it.milestone ? "transparent" : paint.bg, border: it.milestone ? "none" : `1px solid ${isLate(it, c.today) ? "var(--danger)" : on ? "var(--accent)" : paint.line}`,
      // color-mix-ok: h("div") style, a real DOM node of the Plan view
      boxShadow: on ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)" : "none",
    },
  }, it.milestone ? icon(ICON.diamond, { color: it.status === "done" ? "var(--ok)" : "var(--ink-2)" }) : h(FaceButton, { it, size: 14, ctx: c }), h(NameField, { it, ctx: c, style: { minWidth: 0 } }));
}

export function calendarView(c: PlanCtx, height: number): ReactElement {
  const items = c.items.filter((x) => passes(x, c.filter, c.today));
  const weeks = calendarWeeks(items, c.today, c.calMonth);
  const wk: ReactNode[] = [];
  for (const w of weeks) {
    const cells: ReactNode[] = [];
    // color-mix-ok: h("div") style, a real DOM node of the Plan view
    for (const d of w.days) cells.push(h("div", { key: d.day, style: { padding: "4px 6px", borderRight: "1px solid var(--line)", background: d.today ? "color-mix(in srgb, var(--accent) 8%, transparent)" : d.weekend ? "color-mix(in srgb, var(--sunk) 60%, transparent)" : "transparent", opacity: d.other ? 0.5 : 1 } },
      h("span", { style: { fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: d.today ? "var(--accent)" : "var(--ink-3)", fontWeight: d.today ? 700 : 500 } }, d.label)));
    const evs: ReactNode[] = [];
    for (const sg of w.segs) evs.push(bar(c, sg));
    wk.push(h("div", { key: w.start, "data-week": w.start, style: { position: "relative", minHeight: 104, borderBottom: "1px solid var(--line)" } },
      h("div", { style: { position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)" } }, ...cells),
      h("div", { style: { position: "relative", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: 24, paddingTop: 24 } }, ...evs)));
  }
  const navBtn = (d: number, label: string, flip: boolean): ReactElement => h("button", { type: "button", "aria-label": label, "data-testid": d < 0 ? "plan-cal-prev" : "plan-cal-next", onClick: () => c.setCalMonth(Math.max(0, Math.min(11, c.calMonth + d))), style: { border: 0, background: "none", cursor: "pointer", color: "var(--ink-2)", display: "inline-flex", padding: 4, transform: flip ? "scaleX(-1)" : "none" }, dangerouslySetInnerHTML: { __html: ICON.back } });
  return h("div", { "data-testid": "plan-calendar", style: { overflow: "auto", height, border: "1px solid var(--line)", borderRadius: 10, background: "var(--win)" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px" } }, navBtn(-1, "Previous month", false), h("b", { style: { fontSize: 13.5, minWidth: 90, textAlign: "center" } }, MONL[c.calMonth]), navBtn(1, "Next month", true)),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, borderBottom: "1px solid var(--line)" } }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("span", { key: d, style: { padding: "4px 6px" } }, d))),
    ...wk);
}
