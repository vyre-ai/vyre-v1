// ui/Plan board view: one column per stage, a card per task. Drag a card to another column to move it to that stage.
import type { ReactElement, ReactNode } from "react";
import { menuTrigger } from "../Menu/index.tsx";
import { fmtDay, fmtWeekday, isLate, passes } from "./logic.ts";
import type { Item } from "./logic.ts";
import { FaceButton, ICON, NameField, StatusMark, h, icon } from "./parts.tsx";
import type { EventLike, PlanCtx } from "./parts.tsx";

function card(c: PlanCtx, it: Item): ReactElement {
  const on = c.sel.has(it.id), ring = it.status === "review" || it.status === "approval";
  return h("div", {
    key: it.id, role: "button", "aria-pressed": on, draggable: true, tabIndex: -1, "data-testid": `plan-card-${it.id}`,
    onClick: (e: EventLike) => c.select(it.id, e.metaKey || e.ctrlKey, e.shiftKey), onDoubleClick: () => c.open(it.id), ...menuTrigger((x: number, y: number) => c.menu(it.id, x, y)),
    onDragStart: (e: EventLike) => { if (!c.sel.has(it.id)) c.only(it.id); c.cardDragStart(it.id); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); } },
    style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 9, background: "var(--raised)", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, boxShadow: on ? "0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)" : "none", cursor: "grab" },
  },
  h("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } },
    h("button", { type: "button", "aria-label": it.status === "done" ? "Reopen" : "Mark done", "data-testid": `plan-done-${it.id}`, onClick: (e: EventLike) => { e.stopPropagation(); c.toggleDone(c.sel.has(it.id) && c.sel.size > 1 ? [...c.sel] : [it.id]); }, style: { border: 0, background: "none", padding: 0, cursor: "pointer", display: "inline-flex" } },
      it.milestone ? icon(ICON.diamond, { color: it.status === "done" ? "var(--ok)" : "var(--ink-2)" }) : h(StatusMark, { status: it.status })),
    h(NameField, { it, ctx: c, style: { flex: 1, minWidth: 0 } })),
  h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" } },
    it.milestone ? null : h(FaceButton, { it, size: 18, ctx: c }),
    h("span", { style: { fontVariantNumeric: "tabular-nums", color: isLate(it, c.today) ? "var(--danger)" : "var(--ink-3)" } }, it.milestone ? `${fmtWeekday(it.s)} ${fmtDay(it.s)}` : it.s === it.e ? fmtDay(it.s) : `${fmtDay(it.s)} to ${fmtDay(it.e)}`),
    ring ? h("span", { style: { color: "var(--accent)", fontWeight: 600 } }, it.status === "review" ? "Review" : "Approval") : it.status === "blocked" ? h("span", { style: { color: "var(--warn)", fontWeight: 600 } }, "Blocked") : null,
    h("span", { style: { flex: 1 } }),
    it.effort && !it.milestone ? h("span", { style: { fontVariantNumeric: "tabular-nums" } }, it.effort) : null));
}

export function boardView(c: PlanCtx, height: number): ReactElement {
  const cols: ReactNode[] = [];
  for (const st of c.stages) {
    const all = c.items.filter((x) => x.stage === st.id);
    const its = all.filter((x) => passes(x, c.filter, c.today)).sort((a, b) => a.s - b.s || a.e - b.e);
    const cards: ReactNode[] = [];
    for (const it of its) cards.push(card(c, it));
    cols.push(h("div", {
      key: st.id, "data-testid": `plan-col-${st.id}`,
      onDragOver: (e: EventLike) => e.preventDefault(), onDrop: (e: EventLike) => { e.preventDefault(); c.cardDrop(st.id); },
      style: { flex: "1 1 240px", minWidth: 240, display: "flex", flexDirection: "column", gap: 8, padding: 8, borderRadius: 10, background: "var(--sunk)" },
    },
    h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "2px 4px", fontSize: 12.5 } },
      h("b", null, st.name), h("span", { style: { color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, its.length === all.length ? String(all.length) : `${its.length} of ${all.length}`),
      c.canAdd ? h("button", { type: "button", "aria-label": `Add a task to ${st.name}`, title: "Add a task", "data-testid": `plan-add-${st.id}`, onClick: () => c.add(st.id), style: { marginLeft: "auto", border: 0, background: "none", cursor: "pointer", color: "var(--ink-3)", display: "inline-flex", padding: 2 }, dangerouslySetInnerHTML: { __html: ICON.plus } }) : null),
    ...(cards.length > 0 ? cards : [h("div", { key: "none", style: { padding: "14px 6px", fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" } }, "Nothing here")])));
  }
  return h("div", { "data-testid": "plan-board", style: { display: "flex", gap: 10, alignItems: "flex-start", overflow: "auto", height, padding: 2 } }, ...cols);
}
