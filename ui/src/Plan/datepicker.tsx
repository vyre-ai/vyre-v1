// ui/Plan date picker: the small month popover for a task's due day (the prototype's pickDate). Draws in the root overlay, fixed to the window, so no lane or row can cover it.
// Click a day to pick it; the arrows move the month; Escape or a click outside closes it. The picked day is where the task now ends.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Overlay } from "../Overlay/index.tsx";
import { fmtDay, pickMonth } from "./logic.ts";
import { BTN, ICON, h, win } from "./parts.tsx";
import type { EventLike } from "./parts.tsx";

export interface PickerState { x: number; y: number; cur: number; ids: readonly string[] }

export function DatePicker({ at, today, onPick, onClose }: { at: PickerState; today: number; onPick: (day: number) => void; onClose: () => void }): ReactElement {
  const [step, setStep] = useState(0);
  const m = pickMonth(at.cur, today, step);
  useEffect(() => {
    const off = (e: EventLike): void => { if (!e.target.closest("[data-plan-datepicker]")) onClose(); };
    const key = (e: EventLike): void => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    // listen a tick later so the press that opened the picker does not close it
    const t = setTimeout(() => { win().addEventListener("mousedown", off); win().addEventListener("keydown", key); }, 0);
    return () => { clearTimeout(t); win().removeEventListener("mousedown", off); win().removeEventListener("keydown", key); };
  }, [onClose]);
  const cells: ReactNode[] = [];
  for (let i = 0; i < m.lead; i++) cells.push(h("span", { key: `b${i}` }));
  for (const d of m.days) {
    cells.push(h("button", {
      key: d.day, type: "button", "data-testid": `plan-dp-${d.label}`, "aria-label": fmtDay(d.day), "aria-pressed": d.on, onClick: () => onPick(d.day),
      style: { height: 28, border: 0, borderRadius: 7, cursor: "pointer", font: "inherit", fontSize: 12.5, fontVariantNumeric: "tabular-nums", background: d.on ? "var(--accent)" : "transparent", color: d.on ? "var(--accent-ink)" : d.today ? "var(--accent)" : d.weekend ? "var(--ink-3)" : "var(--ink)", fontWeight: d.today || d.on ? 700 : 500 },
    }, d.label));
  }
  const nav = (d: number, label: string, flip: boolean): ReactElement => h("button", { type: "button", "aria-label": label, "data-testid": d < 0 ? "plan-dp-prev" : "plan-dp-next", onClick: () => setStep(step + d), style: { ...BTN, border: 0, background: "none", padding: 4, display: "inline-flex", transform: flip ? "scaleX(-1)" : "none" }, dangerouslySetInnerHTML: { __html: ICON.back } });
  return (
    <Overlay>
      {h("div", {
        role: "dialog", "aria-label": "Pick a due date", "data-plan-datepicker": true, "data-testid": "plan-datepicker",
        style: { position: "fixed", left: Math.max(8, at.x), top: Math.max(8, at.y), zIndex: 2147483001, width: 232, padding: 10, borderRadius: 12, background: "var(--raised)", boxShadow: "var(--sh-pop)", color: "var(--ink)", boxSizing: "border-box" },
      },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 6 } }, nav(-1, "Previous month", false), h("b", { style: { fontSize: 13 } }, `${m.title} ${m.year}`), nav(1, "Next month", true)),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontSize: 11, color: "var(--ink-3)", textAlign: "center", paddingBottom: 2 } }, ...["M", "T", "W", "T", "F", "S", "S"].map((c, i) => h("span", { key: i }, c))),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 } }, ...cells))}
    </Overlay>
  );
}
