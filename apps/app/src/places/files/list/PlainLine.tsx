// Files > list > one line, drawn for the web as plain elements (P-L9e_25): a 10,000-line folder scrolls, and a scroll mounts a few lines a frame, so what one line costs is what the scroll costs.
// The shared Row is a Pressable with a leading box, a text box, a trailing box and four cell views, and the line also had a wrapper view with five drag listeners added in an effect. Here a line is one div,
// one icon box, one title and one box of four cells, all styled by classes from one stylesheet; the drag, click and menu handlers are React's own on the div. Same test ids, same looks, same keys:
// `row-<id>`, `row-<id>-leading`, `row-<id>-trailing`, `cell-modified|by|size|kind`. Off the web the shared Row draws the line (FilesList).
import { createElement } from "react";
import type { ReactElement } from "react";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { COL } from "../FileList.tsx";
import type { Cells } from "../FileList.tsx";
import { Glyph } from "../tree/parts.tsx";
import type { IconName } from "../tree/parts.tsx";
import type { Mods } from "../tree/model.ts";

let cssDone = false;
/** The line's styles, set once. A line only draws after the page is live, so the static export needs none of it. */
export function ensureLineCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: { getElementById(id: string): unknown; createElement(t: string): { id: string; textContent: string }; head?: { appendChild(n: unknown): void } } }).document;
  if (!d || !d.head) return;
  if (d.getElementById("vyre-files-lines")) { cssDone = true; return; }
  const el = d.createElement("style");
  el.id = "vyre-files-lines";
  el.textContent = ".vfl-r{box-sizing:border-box;display:flex;align-items:center;height:28px;margin:5px 6px;padding:0 8px;border-radius:6px;cursor:default}"
    + ".vfl-r:hover{background:var(--hover)}"
    + ".vfl-i{flex:none;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--sunk);margin-right:10px}"
    + ".vfl-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);font-size:13px;line-height:18px}"
    + ".vfl-cs{flex:none;display:flex;align-items:center;gap:" + COL.gap + "px;margin-left:8px}"
    + ".vfl-c{flex:none;white-space:nowrap;color:var(--ink-3);font-size:12.5px;font-variant-numeric:tabular-nums}.vfl-n{text-align:right}"
    + ".vfl-w{flex:none;display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--ink-2);font-size:12.5px}"
    + ".vfl-x{overflow:hidden;text-overflow:ellipsis}.vfl-b{min-width:0}.vfl-b.vfl-x{flex:1}.vfl-f{flex:none;width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--sunk);color:var(--ink-2);font-size:9px;font-weight:600}";
  d.head.appendChild(el);
  cssDone = true;
}

/** The class of a cell's text: plain when it fits its column (a little over the average glyph), and only a text that is too long gets the clip box and its ellipsis. The words stay whole in the page. */
const roomOf = (width: number): number => Math.floor(width / 6.6);
const longer = (text: string, width: number): string => (text.length > roomOf(width) ? " vfl-x" : "");

export interface PlainLineProps {
  /** The Row's id (`line:<key>`): the test ids follow it. */
  id: string;
  name: string;
  icon: IconName;
  folder: boolean;
  selected: boolean;
  hovered: boolean;
  wide: boolean;
  cells: Cells;
  payload(): string;
  onPress(mods: Mods): void;
  onMenu(x: number, y: number): void;
  onOver(): void;
  onLeave(): void;
  onDrop(payload: string): void;
}

export function PlainLine(p: PlainLineProps): ReactElement {
  ensureLineCss();
  const c = p.cells;
  const cells: ReactElement[] = [createElement("span", { key: "m", className: `vfl-c${longer(c.when, COL.modified)}`, "data-testid": "cell-modified", style: { width: COL.modified } }, c.when)];
  if (p.wide) {
    cells.push(
      createElement("span", { key: "b", className: "vfl-w", "data-testid": "cell-by", style: { width: COL.by } }, ...(c.by ? [createElement("span", { key: "f", className: "vfl-f", "aria-hidden": true }, c.by.slice(0, 1).toUpperCase()), createElement("span", { key: "n", className: `vfl-b${longer(c.by, COL.by - 23)}` }, c.by)] : [])),
      createElement("span", { key: "s", className: `vfl-c vfl-n${longer(c.size, COL.size)}`, "data-testid": "cell-size", style: { width: COL.size } }, c.size),
      createElement("span", { key: "k", className: `vfl-c${longer(c.kind, COL.kind)}`, "data-testid": "cell-kind", style: { width: COL.kind } }, c.kind),
    );
  }
  const handlers: Record<string, unknown> = {
    onClick: (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => p.onPress({ meta: e.metaKey === true || e.ctrlKey === true, shift: e.shiftKey === true }),
    onDragStart: (e: { dataTransfer?: { setData(t: string, v: string): void; effectAllowed: string } }) => { e.dataTransfer?.setData("text/plain", p.payload()); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; },
    ...(p.folder ? {
      onDragOver: (e: { preventDefault(): void }) => { e.preventDefault(); p.onOver(); },
      onDragLeave: () => p.onLeave(),
      onDrop: (e: { preventDefault(): void; dataTransfer?: { getData(t: string): string } }) => { e.preventDefault(); p.onDrop(e.dataTransfer?.getData("text/plain") ?? ""); },
    } : {}),
  };
  return createElement(
    "div",
    { "data-testid": `row-${p.id}`, role: "button", "aria-label": p.name, "aria-selected": p.selected, draggable: true, className: "vfl-r", ...(p.selected ? { style: { backgroundColor: "var(--sel)" } } : p.hovered ? { style: { backgroundColor: "var(--hover)" } } : {}), ...handlers, ...menuTrigger(p.onMenu) },
    createElement("div", { className: "vfl-i", "data-testid": `row-${p.id}-leading` }, Glyph({ name: p.icon, size: 18, color: p.folder ? "var(--accent)" : "var(--ink-3)" })),
    createElement("span", { className: "vfl-t" }, p.name),
    createElement("div", { className: "vfl-cs", "data-testid": `row-${p.id}-trailing` }, ...cells),
  );
}
