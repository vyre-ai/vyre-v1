// The workbook as a grid (web): only the rows and columns near the screen are drawn, so a 50,000 row sheet scrolls. The header row and the sheet's frozen rows stay on top, every sheet is a tab at the
// foot, a cell shows its value in its format, and the formula bar shows the formula of the selected cell. Editing goes through the Grid model (typing, paste, rows and columns, undo and redo); this file
// only draws it and turns keys into those calls.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { injectCss } from "../../theme/css.ts";
import { DEFAULT_COL_W, ROW_H, copyBlock, display, inputOf, key, pasteBlock } from "./grid-model.ts";
import type { Grid, GSheet } from "./grid-model.ts";
import { colName } from "./formula.ts";

export interface GridViewProps {
  grid: Grid;
  /** Bumped by the owner after every change to the model, so this redraws. */
  rev: number;
  sheet: number;
  onSheet: (i: number) => void;
  /** Typing is on (Edit, and the file can be changed). */
  edit: boolean;
  /** Why the grid cannot be changed, said once under the formula bar ("This file is view only in Google Drive."). */
  why?: string;
  /** Rows and columns cannot be added or removed here (said once, on the buttons): a Google Sheet takes cell values only. */
  noStructure?: string;
  /** The first row is a header (a CSV): the foot counts the rows under it. */
  header?: boolean;
  find: string;
  /** The cell Find is on, in this sheet, when it is. */
  current: { sheet: number; r: number; c: number } | null;
  /** The cells that match Find in each sheet, by "r,c". */
  matches: ReadonlySet<string>;
  onChange: () => void;
  onSelect?: (a: { sheet: string; r: number; c: number }) => void;
}

const HEAD_H = 26;
const GUTTER = 48;
const CSS = `
.vwg{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:var(--win,#fff);font:13px system-ui;color:var(--ink,#111)}
.vwg-fx{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line,rgba(0,0,0,.08));min-height:36px}
.vwg-name{min-width:48px;text-align:center;color:var(--ink-3,#777);font:600 12px system-ui}
.vwg-in{flex:1;border:0;outline:0;background:none;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink,#111);min-width:0}
.vwg-note{color:var(--ink-3,#777);font-size:12px;white-space:nowrap}
.vwg-btn{border:0;background:none;color:var(--ink-2,#444);padding:4px 7px;border-radius:6px;cursor:pointer;font:600 12px system-ui}
.vwg-btn:hover:not(:disabled){background:var(--sunk,#eee)}
.vwg-btn:disabled{opacity:.35;cursor:default}
.vwg-scroll{position:relative;flex:1;min-height:0;overflow:auto;outline:0;-webkit-overflow-scrolling:touch}
.vwg-head{position:sticky;top:0;z-index:6;height:${HEAD_H}px;background:var(--sunk,#f4f4f5);border-bottom:1px solid var(--line,rgba(0,0,0,.1))}
.vwg-frozen{position:sticky;z-index:5;background:var(--win,#fff);border-bottom:2px solid var(--line,rgba(0,0,0,.14))}
.vwg-body{position:relative}
.vwg-row{position:absolute;left:0}
.vwg-c{position:absolute;box-sizing:border-box;padding:0 8px;line-height:${ROW_H - 1}px;height:${ROW_H}px;border-right:1px solid var(--line,rgba(0,0,0,.07));border-bottom:1px solid var(--line,rgba(0,0,0,.07));overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.vwg-c[data-n="1"]{text-align:right;font-variant-numeric:tabular-nums}
.vwg-c[data-b="1"]{font-weight:650}
.vwg-c[data-stale="1"]{font-style:italic;color:var(--ink-3,#777)}
.vwg-c[data-err="1"]{color:#c2410c}
.vwg-c[data-sel="1"]{outline:2px solid var(--accent,#5b5bd6);outline-offset:-2px;z-index:2;background:color-mix(in srgb,var(--accent,#5b5bd6) 6%,var(--win,#fff))}
.vwg-c[data-find="match"]{background:rgba(255,204,0,.4)}
.vwg-c[data-find="current"]{background:rgba(255,140,0,.55)}
.vwg-h{position:absolute;box-sizing:border-box;height:${HEAD_H}px;line-height:${HEAD_H}px;text-align:center;color:var(--ink-3,#777);font:600 11.5px system-ui;border-right:1px solid var(--line,rgba(0,0,0,.08))}
.vwg-g{position:sticky;left:0;z-index:3;box-sizing:border-box;width:${GUTTER}px;height:${ROW_H}px;line-height:${ROW_H - 1}px;text-align:center;color:var(--ink-4,#999);font:11.5px system-ui;background:var(--sunk,#f4f4f5);border-right:1px solid var(--line,rgba(0,0,0,.1));border-bottom:1px solid var(--line,rgba(0,0,0,.07))}
.vwg-ed{position:absolute;z-index:4;box-sizing:border-box;border:2px solid var(--accent,#5b5bd6);outline:0;padding:0 7px;font:13px system-ui;background:var(--win,#fff);color:var(--ink,#111)}
.vwg-tabs{display:flex;gap:2px;align-items:center;padding:4px 8px;border-top:1px solid var(--line,rgba(0,0,0,.08));overflow-x:auto;background:var(--win,#fff)}
.vwg-tab{border:0;background:none;padding:5px 12px;border-radius:7px;cursor:pointer;color:var(--ink-3,#777);font:600 12.5px system-ui;white-space:nowrap}
.vwg-tab[data-on="1"]{background:var(--sunk,#eee);color:var(--ink,#111)}
.vwg-foot{margin-left:auto;color:var(--ink-3,#777);font-size:12px;white-space:nowrap;padding:0 8px}
`;

const xOf = (s: GSheet, c: number): number => {
  let x = GUTTER;
  for (let i = 0; i < c; i++) x += s.widths[i] ?? DEFAULT_COL_W;
  return x;
};

export function GridView(p: GridViewProps): ReactElement {
  const s = p.grid.book.sheets[p.sheet] ?? p.grid.book.sheets[0]!;
  const [view, setView] = useState({ top: 0, left: 0, w: 900, h: 600 });
  const [sel, setSel] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const editor = useRef<HTMLInputElement | null>(null);
  void p.rev;
  useEffect(() => {
    injectCss(document as never, "vy-viewer-grid", CSS);
  }, []);
  useEffect(() => {
    setSel({ r: 0, c: 0 });
    setDraft(null);
  }, [p.sheet]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = (): void => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const widths = useMemo(
    () => Array.from({ length: Math.max(s.cols, 1) }, (_, c) => s.widths[c] ?? DEFAULT_COL_W),
    [s, p.rev],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = GUTTER;
    for (const w of widths) {
      out.push(x);
      x += w;
    }
    return { lefts: out, total: x };
  }, [widths]);
  const frozen = Math.min(s.frozen.rows, s.rows);
  const bodyRows = Math.max(s.rows - frozen, 0);
  const first = Math.max(0, Math.floor(view.top / ROW_H) - 8);
  const last = Math.min(bodyRows - 1, Math.ceil((view.top + view.h) / ROW_H) + 8);
  // columns near the screen
  let c0 = 0;
  while (c0 < widths.length - 1 && (lefts.lefts[c0 + 1] ?? 0) < view.left - 200) c0++;
  let c1 = c0;
  while (c1 < widths.length - 1 && (lefts.lefts[c1] ?? 0) < view.left + view.w + 200) c1++;

  const merged = useMemo(() => {
    const origin = new Map<string, { r2: number; c2: number }>();
    const hidden = new Set<string>();
    for (const m of s.merges) {
      origin.set(key(m.r, m.c), { r2: m.r2, c2: m.c2 });
      for (let r = m.r; r <= m.r2; r++)
        for (let c = m.c; c <= m.c2; c++) if (r !== m.r || c !== m.c) hidden.add(key(r, c));
    }
    return { origin, hidden };
  }, [s.merges]);

  const canType = p.edit && p.why === undefined;
  const commit = (move: "down" | "right" | "none"): void => {
    if (draft !== null) {
      p.grid.setCell(s, sel.r, sel.c, draft);
      setDraft(null);
      p.onChange();
    }
    if (move === "down") setSel((x) => ({ r: Math.min(x.r + 1, Math.max(s.rows - 1, x.r + 1)), c: x.c }));
    if (move === "right") setSel((x) => ({ r: x.r, c: Math.min(x.c + 1, Math.max(s.cols - 1, x.c + 1)) }));
    scroller.current?.focus();
  };
  const reveal = (r: number, c: number): void => {
    const el = scroller.current;
    if (!el) return;
    const top = (r - frozen) * ROW_H + HEAD_H + frozen * ROW_H;
    if (r >= frozen) {
      if (top < el.scrollTop + HEAD_H + frozen * ROW_H) el.scrollTop = Math.max(0, top - HEAD_H - frozen * ROW_H);
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    const l = lefts.lefts[c] ?? 0;
    if (l < el.scrollLeft + GUTTER) el.scrollLeft = Math.max(0, l - GUTTER);
    else if (l + (widths[c] ?? DEFAULT_COL_W) > el.scrollLeft + el.clientWidth)
      el.scrollLeft = l + (widths[c] ?? DEFAULT_COL_W) - el.clientWidth;
  };
  const move = (dr: number, dc: number): void => {
    const r = Math.max(0, Math.min(s.rows - 1 + (dr > 0 ? 0 : 0), sel.r + dr));
    const c = Math.max(0, Math.min(s.cols - 1, sel.c + dc));
    setSel({ r, c });
    reveal(r, c);
    p.onSelect?.({ sheet: s.name, r, c });
  };

  // Find: bring the current match into view (in its own sheet)
  useEffect(() => {
    if (p.current && p.current.sheet !== p.sheet) p.onSheet(p.current.sheet);
    if (p.current && p.current.sheet === p.sheet) {
      setSel({ r: p.current.r, c: p.current.c });
      reveal(p.current.r, p.current.c);
    }
  }, [p.current?.sheet, p.current?.r, p.current?.c, p.sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (draft !== null) editor.current?.focus();
  }, [draft]);

  const onKey = (e: KeyboardEvent): void => {
    if (draft !== null) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (canType && (e.shiftKey ? p.grid.redo() : p.grid.undo())) p.onChange();
      return;
    }
    if (meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      if (canType && p.grid.redo()) p.onChange();
      return;
    }
    if (meta) return;
    const k = e.key;
    if (k === "ArrowDown") return void (e.preventDefault(), move(1, 0));
    if (k === "ArrowUp") return void (e.preventDefault(), move(-1, 0));
    if (k === "ArrowLeft") return void (e.preventDefault(), move(0, -1));
    if (k === "ArrowRight" || k === "Tab")
      return void (e.preventDefault(), move(0, k === "Tab" && e.shiftKey ? -1 : 1));
    if (!canType) return;
    if (k === "Enter" || k === "F2")
      return void (e.preventDefault(), setDraft(inputOf(s.cells.get(key(sel.r, sel.c)))));
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      p.grid.setCell(s, sel.r, sel.c, "");
      p.onChange();
      return;
    }
    if (k.length === 1) {
      e.preventDefault();
      setDraft(k);
    }
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (!canType || draft !== null) return;
    const text = e.clipboardData?.getData("text/plain");
    if (text === undefined || text === "") return;
    e.preventDefault();
    p.grid.setMany(s, pasteBlock(text, sel.r, sel.c));
    p.onChange();
  };
  const onCopy = (e: ClipboardEvent): void => {
    if (draft !== null) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", copyBlock(s, sel.r, sel.c, sel.r, sel.c));
  };

  const cellEl = (r: number, c: number, top: number): ReactElement | null => {
    const k = key(r, c);
    if (merged.hidden.has(k)) return null;
    const cell = s.cells.get(k);
    const m = merged.origin.get(k);
    const w = m
      ? (lefts.lefts[m.c2] ?? 0) + (widths[m.c2] ?? DEFAULT_COL_W) - (lefts.lefts[c] ?? 0)
      : (widths[c] ?? DEFAULT_COL_W);
    const h = m ? (m.r2 - r + 1) * ROW_H : ROW_H;
    const shown = display(cell);
    const isSel = sel.r === r && sel.c === c;
    const cur = p.current !== null && p.current.sheet === p.sheet && p.current.r === r && p.current.c === c;
    const find = p.find !== "" && p.matches.has(k) ? (cur ? "current" : "match") : undefined;
    return createElement(
      "div",
      {
        key: c,
        className: "vwg-c",
        "data-testid": `vwg-cell-${r}-${c}`,
        "data-n": typeof cell?.v === "number" && cell.err === undefined ? "1" : "0",
        "data-b": cell?.b === true ? "1" : "0",
        "data-stale": cell?.stale === true ? "1" : "0",
        "data-err": cell?.err !== undefined ? "1" : "0",
        "data-sel": isSel ? "1" : "0",
        ...(find ? { "data-find": find } : {}),
        style: { left: (lefts.lefts[c] ?? 0) - GUTTER, width: w, height: h, top: 0, marginLeft: GUTTER },
        title:
          cell?.stale === true
            ? "This formula is not recalculated here. It shows the last value from the file."
            : undefined,
        onMouseDown: () => {
          if (draft !== null) commit("none");
          setSel({ r, c });
          p.onSelect?.({ sheet: s.name, r, c });
          scroller.current?.focus();
        },
        onDoubleClick: () => canType && setDraft(inputOf(cell)),
      },
      shown,
    );
  };
  const rowEl = (r: number, top: number): ReactElement => {
    const cells: (ReactElement | null)[] = [];
    for (let c = c0; c <= c1; c++) cells.push(cellEl(r, c, top));
    return createElement(
      "div",
      { key: r, className: "vwg-row", style: { top, width: lefts.total, height: ROW_H } },
      createElement("div", { className: "vwg-g" }, String(r + 1)),
      ...cells,
    );
  };

  const rowsEls: ReactElement[] = [];
  for (let r = first; r <= last; r++) rowsEls.push(rowEl(frozen + r, r * ROW_H));
  const frozenEls: ReactElement[] = [];
  for (let r = 0; r < frozen; r++) frozenEls.push(rowEl(r, r * ROW_H));
  const headEls: ReactElement[] = [
    createElement("div", { key: "g", className: "vwg-h", style: { left: 0, width: GUTTER } }),
  ];
  for (let c = c0; c <= c1; c++)
    headEls.push(
      createElement(
        "div",
        { key: c, className: "vwg-h", style: { left: lefts.lefts[c] ?? 0, width: widths[c] ?? DEFAULT_COL_W } },
        colName(c),
      ),
    );

  const selCell = s.cells.get(key(sel.r, sel.c));
  const editorBox = (() => {
    if (draft === null) return null;
    const top = sel.r < frozen ? HEAD_H + sel.r * ROW_H : HEAD_H + frozen * ROW_H + (sel.r - frozen) * ROW_H;
    return createElement("input", {
      ref: editor,
      className: "vwg-ed",
      "data-testid": "vwg-editor",
      "aria-label": `Edit ${colName(sel.c)}${sel.r + 1}`,
      value: draft,
      style: {
        left: lefts.lefts[sel.c] ?? 0,
        top,
        width: Math.max(widths[sel.c] ?? DEFAULT_COL_W, 120),
        height: ROW_H,
      },
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onKeyDown: (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") return void (e.preventDefault(), commit("down"));
        if (e.key === "Tab") return void (e.preventDefault(), commit("right"));
        if (e.key === "Escape") return void (setDraft(null), scroller.current?.focus());
      },
    });
  })();
  const block = p.noStructure ?? p.grid.structureBlock(s);
  const bar = createElement(
    "div",
    { className: "vwg-fx", "data-testid": "vwg-fx" },
    createElement("span", { className: "vwg-name", "data-testid": "vwg-name" }, `${colName(sel.c)}${sel.r + 1}`),
    createElement("input", {
      className: "vwg-in",
      "data-testid": "vwg-formula",
      "aria-label": "Formula bar",
      readOnly: !canType,
      value: draft ?? inputOf(selCell),
      placeholder: "",
      onFocus: () => canType && draft === null && setDraft(inputOf(selCell)),
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter") return void (e.preventDefault(), commit("down"));
        if (e.key === "Escape") return void setDraft(null);
      },
    }),
    selCell?.stale === true
      ? createElement(
          "span",
          { className: "vwg-note", "data-testid": "vwg-stale" },
          "Not recalculated here. Shows the last value.",
        )
      : p.why !== undefined
        ? createElement("span", { className: "vwg-note", "data-testid": "vwg-why" }, p.why)
        : null,
    canType
      ? createElement(
          "span",
          { style: { display: "flex", gap: 2 } },
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Undo",
              "data-testid": "vwg-undo",
              disabled: !p.grid.canUndo,
              onClick: () => p.grid.undo() && p.onChange(),
            },
            "Undo",
          ),
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Redo",
              "data-testid": "vwg-redo",
              disabled: !p.grid.canRedo,
              onClick: () => p.grid.redo() && p.onChange(),
            },
            "Redo",
          ),
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Add row",
              "data-testid": "vwg-add-row",
              title: block ?? "",
              disabled: block !== null,
              onClick: () => (p.grid.insert(s, "row", sel.r + 1), p.onChange()),
            },
            "+ Row",
          ),
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Delete row",
              "data-testid": "vwg-del-row",
              title: block ?? "",
              disabled: block !== null || s.rows <= 1,
              onClick: () => (p.grid.remove(s, "row", sel.r), p.onChange()),
            },
            "− Row",
          ),
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Add column",
              "data-testid": "vwg-add-col",
              title: block ?? "",
              disabled: block !== null,
              onClick: () => (p.grid.insert(s, "col", sel.c + 1), p.onChange()),
            },
            "+ Col",
          ),
          createElement(
            "button",
            {
              className: "vwg-btn",
              "aria-label": "Delete column",
              "data-testid": "vwg-del-col",
              title: block ?? "",
              disabled: block !== null || s.cols <= 1,
              onClick: () => (p.grid.remove(s, "col", sel.c), p.onChange()),
            },
            "− Col",
          ),
        )
      : null,
  );
  const tabs = createElement(
    "div",
    { className: "vwg-tabs", "data-testid": "vwg-tabs", role: "tablist" },
    ...(p.grid.book.sheets.length < 2 ? [] : p.grid.book.sheets).map((sh, i) =>
      createElement(
        "button",
        {
          key: sh.name,
          className: "vwg-tab",
          role: "tab",
          "aria-selected": i === p.sheet,
          "data-on": i === p.sheet ? "1" : "0",
          "data-testid": `vwg-tab-${i}`,
          onClick: () => p.onSheet(i),
        },
        sh.name,
      ),
    ),
    createElement(
      "span",
      { className: "vwg-foot", "data-testid": "vwg-foot" },
      `${(p.header ? Math.max(s.rows - 1, 0) : s.rows).toLocaleString("en-US")} rows · ${s.cols} columns`,
    ),
  );
  return createElement(
    "div",
    { className: "vwg", "data-testid": "vwg", "data-sheet": s.name, "data-rows": s.rows },
    bar,
    createElement(
      "div",
      {
        className: "vwg-scroll",
        ref: scroller,
        tabIndex: 0,
        "data-testid": "vwg-scroll",
        onScroll: (e: { currentTarget: HTMLElement }) => {
          const top = e.currentTarget.scrollTop;
          const left = e.currentTarget.scrollLeft;
          setView((v) => ({ ...v, top, left }));
        },
        onKeyDown: onKey,
        onPaste,
        onCopy,
      },
      createElement("div", { className: "vwg-head", style: { width: lefts.total } }, ...headEls),
      frozen > 0
        ? createElement(
            "div",
            {
              className: "vwg-frozen",
              style: { top: HEAD_H, height: frozen * ROW_H, width: lefts.total, position: "sticky" },
            },
            ...frozenEls,
          )
        : null,
      createElement(
        "div",
        { className: "vwg-body", style: { height: bodyRows * ROW_H, width: lefts.total } },
        ...rowsEls,
      ),
      editorBox,
    ),
    tabs,
  );
}
