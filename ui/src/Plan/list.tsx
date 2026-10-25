// ui/Plan list view: one row per task under its stage, with who has it, the reviewer, the dates and the effort. Click a face to change who.
import type { ReactElement, ReactNode } from "react";
import { menuTrigger } from "../Menu/index.tsx";
import { fmtDay, isLate, passes } from "./logic.ts";
import type { Item } from "./logic.ts";
import { Face, FaceButton, ICON, NameField, StatusMark, h, icon } from "./parts.tsx";
import type { ElLike, EventLike, PlanCtx } from "./parts.tsx";

const COLS = "34px minmax(180px, 1fr) 150px 150px 74px 74px 60px";

function cell(c: PlanCtx, it: Item, slot: "who" | "reviewer"): ReactElement {
  const w = slot === "who" ? it.who : it.reviewer;
  return h("span", { role: "button", "data-testid": `plan-${slot}-${it.id}`, title: slot === "who" ? "Change who is assigned" : it.reviewer ? "Change the reviewer" : "Add a reviewer", onClick: (e: EventLike) => { e.stopPropagation(); c.assign(it.id, e.currentTarget as ElLike, slot); }, style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, cursor: "pointer", color: w ? "var(--ink)" : "var(--ink-3)" } },
    w ? h(slot === "who" ? FaceButton : (Face as never), (slot === "who" ? { it, size: 20, ctx: c } : { who: w, size: 20 }) as never) : h("span", { style: { width: 20, height: 20, borderRadius: 99, border: "1.5px dashed var(--ink-4)", boxSizing: "border-box", flex: "none" } }),
    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 } }, w ? w.name : "Add"));
}

export function listView(c: PlanCtx, height: number): ReactElement {
  const rows: ReactNode[] = [];
  rows.push(h("div", { key: "head", style: { display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 8, padding: "6px 12px", fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--win)", zIndex: 2 } },
    h("span", null), h("span", null, "Task"), h("span", null, "Assigned"), h("span", null, "Reviewer"), h("span", null, "Start"), h("span", null, "Due"), h("span", null, "Effort")));
  for (const st of c.stages) {
    const its = c.items.filter((x) => x.stage === st.id && passes(x, c.filter, c.today)).sort((a, b) => a.s - b.s || a.e - b.e);
    const col = c.collapsed[st.id] === true;
    const tasks = its.filter((x) => !x.milestone);
    const dn = tasks.filter((x) => x.status === "done").length;
    rows.push(h("div", { key: `g-${st.id}`, style: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px 4px" } },
      h("button", { type: "button", "aria-expanded": !col, "data-testid": `plan-stage-${st.id}`, onClick: () => c.toggleStage(st.id), style: { border: 0, background: "none", font: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: 0, color: "var(--ink)" } },
        h("span", { style: { display: "inline-flex", transform: col ? "rotate(-90deg)" : "none" }, dangerouslySetInnerHTML: { __html: ICON.chev } }), h("b", { style: { fontSize: 12.5 } }, st.name), h("span", { style: { fontSize: 11.5, color: "var(--ink-3)" } }, `${dn} of ${tasks.length}`)),
      c.canAdd ? h("button", { type: "button", "aria-label": "Add a task", title: "Add a task", "data-testid": `plan-add-${st.id}`, onClick: () => c.add(st.id), style: { marginLeft: "auto", border: 0, background: "none", cursor: "pointer", color: "var(--ink-3)", display: "inline-flex", padding: 2 }, dangerouslySetInnerHTML: { __html: ICON.plus } }) : null));
    if (col) continue;
    for (const it of its) {
      const on = c.sel.has(it.id), ring = it.status === "review" || it.status === "approval";
      rows.push(h("div", {
        key: it.id, role: "row", "aria-selected": on, "data-testid": `plan-listrow-${it.id}`,
        onClick: (e: EventLike) => c.select(it.id, e.metaKey || e.ctrlKey, e.shiftKey), onDoubleClick: () => c.open(it.id), ...menuTrigger((x: number, y: number) => c.menu(it.id, x, y)),
        style: { display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 8, padding: "0 12px", height: 36, fontSize: 13, background: on ? "var(--hover)" : "transparent", cursor: "default" },
      },
      h("span", { style: { display: "flex", justifyContent: "center" } }, h("button", { type: "button", "aria-label": it.status === "done" ? "Reopen" : "Mark done", "data-testid": `plan-done-${it.id}`, onClick: (e: EventLike) => { e.stopPropagation(); c.toggleDone(on && c.sel.size > 1 ? [...c.sel] : [it.id]); }, style: { border: 0, background: "none", padding: 0, cursor: "pointer", display: "inline-flex" } }, it.milestone ? icon(ICON.diamond, { color: it.status === "done" ? "var(--ok)" : "var(--ink-2)" }) : h(StatusMark, { status: it.status, size: 16 }))),
      h("span", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } }, h(NameField, { it, ctx: c, style: { minWidth: 0 } }), ring ? h("span", { style: { fontSize: 11.5, color: "var(--accent)", whiteSpace: "nowrap" } }, it.status === "review" ? "Waiting on review" : "Waiting on approval") : it.status === "blocked" ? h("span", { style: { fontSize: 11.5, color: "var(--warn)" } }, "Blocked") : null),
      cell(c, it, "who"), cell(c, it, "reviewer"),
      h("span", { style: { fontVariantNumeric: "tabular-nums", color: "var(--ink-2)", fontSize: 12.5 } }, it.milestone ? "" : fmtDay(it.s)),
      h("span", { style: { fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: isLate(it, c.today) ? "var(--danger)" : "var(--ink-2)" } }, fmtDay(it.e)),
      h("span", { style: { fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: "var(--ink-3)" } }, it.effort)));
    }
  }
  return h("div", { "data-testid": "plan-list", style: { overflow: "auto", height, border: "1px solid var(--line)", borderRadius: 10, background: "var(--win)" } }, ...rows);
}
