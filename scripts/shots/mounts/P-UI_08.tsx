// Mount for P-UI_08: unstyled elements that browsers set in serif or system fonts when nothing sets a family: a bare input (the Find box), a menu and a dialog
// (overlay roots), SVG text (map and timeline labels), a canvas label host, and code. With the root font rule every one reads in the skin's sans or mono.
import { createElement } from "react";
import type { ReactNode } from "react";

export const title = "Root font";

const h = createElement;

export default function Mount(): ReactNode {
  return h("div", { "data-testid": "rootfont", style: { padding: 24, display: "grid", gap: 16, color: "var(--ink)", background: "var(--win)", fontSize: 14 } },
    h("input", { "data-testid": "find", defaultValue: "Find in memory", style: { padding: 6, width: 220 } }),
    h("div", { role: "menu", "data-testid": "menu", style: { padding: 8, border: "1px solid var(--line)", width: 220 } }, "Rename", h("br"), "Move to Group"),
    h("div", { role: "dialog", "data-testid": "dialog", style: { padding: 8, border: "1px solid var(--line)", width: 220 } }, "Delete this record?"),
    h("svg", { width: 320, height: 48, "data-testid": "svg" }, h("text", { x: 4, y: 20, fill: "currentColor" }, "Timeline bar label, Oct 24"), h("text", { x: 4, y: 40, fill: "currentColor" }, "Map label: Rivera matter")),
    h("div", { "data-canvas-labels": "", "data-testid": "labels", style: { padding: 8, border: "1px solid var(--line)", width: 220 } }, h("span", null, "Canvas label host")),
    h("pre", { "data-testid": "code" }, "railway up --service website"),
  );
}
