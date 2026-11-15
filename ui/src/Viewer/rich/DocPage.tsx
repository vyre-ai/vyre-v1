// A Word file as a page (web): headings, fonts' weight and size, lists, tables, pictures, links, page breaks, the header and footer, footnotes. In Edit its paragraphs are typed into where the file
// allows (a paragraph with a tracked change, a content control or a field stays read only and says why), with bold, italic, underline and the heading level over a selection. The words go back into the
// file through ui/Viewer/rich/docx.ts; this file only draws and turns typing into those calls.
import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { injectCss } from "../../theme/css.ts";
import { applyRunTexts, setHeading, textRuns, toggleFormat } from "./docx.ts";
import type { DBlock, DPara, DRun, DocxModel, RunProps } from "./docx.ts";
import type { DecorRange } from "./types.ts";

export interface DocPageProps {
  model: DocxModel;
  /** Bumped after a change that needs the page redrawn (a format or a heading), not after typing. */
  rev: number;
  zoom: number;
  edit: boolean;
  why?: string;
  /** The bytes of a picture, by the entry name in the file. */
  imageUrl: (path: string) => string | undefined;
  decor: (block: number) => DecorRange[];
  /** The block (paragraph) Find is on, to bring into view. */
  currentBlock: number | null;
  onChange: () => void;
  onRedraw: () => void;
}

const CSS = `
.vww{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:var(--sunk,#eee);outline:0}
.vww-fmt{display:flex;align-items:center;gap:2px;padding:6px 10px;border-bottom:1px solid var(--line,rgba(0,0,0,.08));background:var(--win,#fff);min-height:36px}
.vww-fmt button,.vww-fmt select{border:0;background:none;color:var(--ink-2,#444);padding:4px 9px;border-radius:6px;cursor:pointer;font:600 12.5px system-ui}
.vww-fmt button:hover,.vww-fmt select:hover{background:var(--sunk,#eee)}
.vww-fmt .vww-why{margin-left:auto;color:var(--ink-3,#777);font:12px system-ui}
.vww-scroll{flex:1;min-height:0;overflow:auto;padding:24px 16px 48px;-webkit-overflow-scrolling:touch}
.vww-card{margin:0 auto;background:#fff;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);box-sizing:border-box;max-width:100%;overflow-wrap:anywhere}
.vww-p{margin:0;min-height:1em;white-space:pre-wrap;outline:0;position:relative}
.vww-p[contenteditable="true"]:focus{background:rgba(91,91,214,.04)}
.vww-p[data-ro="1"]{cursor:default}
.vww-p[data-ro="1"][data-edit="1"]::after{content:attr(data-why);position:absolute;right:0;top:-2px;font:11px system-ui;color:#999;background:#fff;padding:0 4px;opacity:0;transition:opacity .12s}
.vww-p[data-ro="1"][data-edit="1"]:hover::after{opacity:1}
.vww-mk{display:inline-block;min-width:1.5em;user-select:none}
.vww-hf{color:#8a8a8a;font-size:.85em}
.vww-pb{border:0;border-top:1px dashed #cfcfcf;margin:18px -4px}
.vww-card table{border-collapse:collapse;width:100%;table-layout:fixed;margin:6px 0}
.vww-card td{border:1px solid #cfcfcf;padding:3px 6px;vertical-align:top}
.vww-fn{margin-top:18px;padding-top:8px;border-top:1px solid #ddd;font-size:.85em;color:#444}
.vww-card mark.vwf{background:rgba(255,204,0,.5);color:inherit;border-radius:2px}
.vww-card mark.vwf-on{background:rgba(255,140,0,.7);outline:2px solid rgba(255,140,0,.9)}
.vww-card a{color:#0563c1}
.vww-card img{max-width:100%;height:auto}
.vww-card sup{font-size:.7em}
`;

const PX = 96 / 72;
const css = (p: RunProps, z: number): Record<string, string | number> => ({
  ...(p.b ? { fontWeight: 700 } : {}),
  ...(p.i ? { fontStyle: "italic" } : {}),
  ...(p.u || p.strike ? { textDecoration: `${p.u ? "underline" : ""} ${p.strike ? "line-through" : ""}`.trim() } : {}),
  ...(p.sz ? { fontSize: `${p.sz * z}pt` } : {}),
  ...(p.color ? { color: p.color } : {}),
  ...(p.font ? { fontFamily: `"${p.font}", system-ui, sans-serif` } : {}),
});

/** Splits [0, len) at the decorations' edges into pieces, each with the decorations that cover it. */
function pieces(len: number, ds: readonly DecorRange[]): { s: number; e: number; d: DecorRange[] }[] {
  const cuts = new Set<number>([0, len]);
  for (const d of ds) {
    cuts.add(Math.max(0, Math.min(len, d.s)));
    cuts.add(Math.max(0, Math.min(len, d.e)));
  }
  const xs = [...cuts].sort((a, b) => a - b);
  const out: { s: number; e: number; d: DecorRange[] }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) out.push({ s: xs[i]!, e: xs[i + 1]!, d: ds.filter((d) => d.s <= xs[i]! && d.e >= xs[i + 1]!) });
  return out;
}
const attrsOf = (d: DecorRange[]): Record<string, string> => {
  const o: Record<string, string> = {};
  const rx = d.find((x) => x.kind === "redact");
  const hl = d.find((x) => x.kind === "highlight");
  const cm = d.find((x) => x.kind === "comment");
  if (rx) Object.assign(o, { "data-rdx": "1", "data-mark": rx.id ?? "" });
  if (hl) Object.assign(o, { "data-hlt": "1", "data-mark": hl.id ?? "" });
  if (cm) Object.assign(o, { "data-cmk": "1", "data-comment": cm.id ?? "" });
  return o;
};

interface ParaProps {
  q: DPara;
  hf: boolean;
  /** The marks on this paragraph, or null for a header or footer paragraph (nothing to find or comment on). */
  ds: DecorRange[] | null;
  m: DocxModel;
  z: number;
  editable: boolean;
  imageUrl: (path: string) => string | undefined;
  onChange: () => void;
  rev: number;
  sig: string;
}
/** The paragraph being typed into: it is never redrawn under the caret by a mark that moved (a comment's words shifting as the text changes). */
let typing: string | null = null;

function ParaView({ q, hf, ds, m, z, editable, imageUrl, onChange }: ParaProps): ReactElement {
    const bi = ds === null ? -1 : 0;
    ds = ds ?? [];
    const runs = textRuns(q);
    let at = 0;
    const kidsEls: ReactNode[] = [];
    if (q.list) kidsEls.push(createElement("span", { key: "mk", className: "vww-mk", contentEditable: false }, q.list.marker));
    q.runs.forEach((r, ri) => {
      if (r.image) {
        const path = m.media[r.image.rid];
        const url = path ? imageUrl(path) : undefined;
        kidsEls.push(createElement("img", { key: ri, src: url, alt: r.image.alt, width: r.image.w * z, height: r.image.h * z, contentEditable: false, "data-testid": "vww-img" }));
        return;
      }
      if (r.footnote !== undefined) {
        kidsEls.push(createElement("sup", { key: ri, contentEditable: false }, String(Number(r.footnote))));
        return;
      }
      if (r.pageBreak) kidsEls.push(createElement("hr", { key: ri, className: "vww-pb", contentEditable: false }));
      if (r.lineBreak) kidsEls.push(createElement("br", { key: ri }));
      const idx = runs.indexOf(r);
      const start = at;
      at += r.text.length;
      if (r.text === "" && idx < 0) return;
      const parts = pieces(r.text.length, ds.map((d) => ({ ...d, s: d.s - start, e: d.e - start })).filter((d) => d.e > 0 && d.s < r.text.length));
      const inner: ReactNode[] =
        r.text === ""
          ? []
          : parts.map((pc, k) => {
              const txt = r.text.slice(pc.s, pc.e);
              if (pc.d.length === 0) return txt;
              const find = pc.d.find((x) => x.kind === "find" || x.kind === "find-on");
              const at2 = attrsOf(pc.d);
              return createElement(find ? "mark" : "span", { key: k, ...(find ? { className: find.kind === "find-on" ? "vwf vwf-on" : "vwf", "data-find": find.kind === "find-on" ? "current" : "match" } : {}), ...at2 }, txt);
            });
      const style = css({ ...r.props, ...(q.heading && !r.props.sz ? {} : {}) }, z);
      const span = createElement("span", { key: ri, style, ...(idx >= 0 && q.why === undefined ? { "data-r": idx } : {}), ...(r.tracked ? { "data-tracked": r.tracked } : {}) }, ...inner);
      kidsEls.push(
        r.link
          ? createElement("a", { key: ri, href: r.link, target: "_blank", rel: "noopener noreferrer", style: { color: "#0563c1" }, onClick: (e: MouseEvent) => editable && !(e.metaKey || e.ctrlKey) && e.preventDefault() }, span)
          : r.tracked === "del"
            ? createElement("span", { key: ri, style: { textDecoration: "line-through", color: "#b42318" } }, span)
            : r.tracked === "ins"
              ? createElement("span", { key: ri, style: { textDecoration: "underline", color: "#067647" } }, span)
              : span,
      );
    });
    const ro = q.why !== undefined;
    return createElement(
      "div",
      {
        key: q.id,
        className: `vww-p${hf ? " vww-hf" : ""}`,
        "data-pid": q.id,
        "data-testid": bi >= 0 ? `vw-block-${q.id}` : undefined,
        "data-tag": q.heading ? `h${q.heading > 1 ? 2 : 1}` : "p",
        "data-ro": ro ? "1" : "0",
        "data-edit": editable ? "1" : "0",
        ...(ro && q.why ? { "data-why": q.why } : {}),
        contentEditable: editable && !ro && !hf,
        suppressContentEditableWarning: true,
        spellCheck: true,
        style: {
          textAlign: q.align as never,
          marginLeft: ((q.indent ?? 0) + (q.list ? 18 * (q.list.level + 1) : 0)) * z,
          marginTop: (q.before ?? 0) * z,
          marginBottom: (q.after ?? 8) * z,
          ...css({ ...q.base, ...(q.heading && !q.base.sz ? { sz: q.heading === 1 ? 20 : 15, b: true } : {}) }, z),
        },
        onKeyDown: (e: KeyboardEvent) => {
          // a new paragraph is not made here: it would have to be written into the file's structure
          if (e.key === "Enter") e.preventDefault();
        },
        onPaste: (e: ClipboardEvent) => {
          e.preventDefault();
          const t = e.clipboardData?.getData("text/plain")?.replace(/\s*\n\s*/g, " ") ?? "";
          if (t !== "") document.execCommand("insertText", false, t);
        },
        onBlur: () => {
            if (typing === q.id) typing = null;
          },
          onInput: (e: { currentTarget: HTMLElement }) => {
            typing = q.id;
          const spans = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-r]"));
          const texts: string[] = runs.map((_, i) => spans.find((s) => s.dataset["r"] === String(i))?.textContent ?? "");
          applyRunTexts(m, q, texts);
          onChange();
        },
      },
      ...kidsEls,
    );
  }

const Para = memo(ParaView, (a, b) => {
  if (a.rev !== b.rev || a.z !== b.z || a.editable !== b.editable || a.m !== b.m || a.hf !== b.hf) return false;
  if (typing === b.q.id) return true;
  return a.sig === b.sig;
});

export function DocPage(p: DocPageProps): ReactElement {
  const z = p.zoom;
  const root = useRef<HTMLDivElement | null>(null);
  const [blockOf] = useState(() => new Map<string, number>());
  useEffect(() => {
    injectCss(document as never, "vy-viewer-doc", CSS);
  }, []);
  const m = p.model;
  const editable = p.edit && p.why === undefined;
  const order = useMemo(() => {
    blockOf.clear();
    m.paras.forEach((q, i) => blockOf.set(q.id, i));
    return blockOf;
  }, [m, blockOf, p.rev]);

  const paraEl = (q: DPara, hf = false): ReactElement => {
    const bi = order.get(q.id) ?? -1;
    const ds = bi >= 0 ? p.decor(bi).filter((d) => !(editable && (d.kind === "find" || d.kind === "find-on"))) : null;
    return createElement(Para, { key: q.id, q, hf, ds, m, z, editable, imageUrl: p.imageUrl, onChange: p.onChange, rev: p.rev, sig: JSON.stringify(ds) });
  };
  const blocks = (bs: readonly DBlock[], hf = false): ReactNode[] =>
    bs.map((b, i) =>
      b.t === "p"
        ? paraEl(b.p, hf)
        : createElement(
            "table",
            { key: b.tbl.id, "data-testid": "vww-table" },
            createElement(
              "tbody",
              null,
              ...b.tbl.rows.map((row, ri) =>
                createElement("tr", { key: ri }, ...row.map((c, ci) => createElement("td", { key: ci, colSpan: c.span, style: c.fill ? { background: c.fill } : undefined }, ...blocks(c.blocks)))),
              ),
            ),
          ),
    );

  // Find: bring the current paragraph into view
  useEffect(() => {
    if (p.currentBlock === null) return;
    const q = m.paras[p.currentBlock];
    if (!q) return;
    const el = root.current?.querySelector(`[data-pid="${q.id}"] .vwf-on, [data-pid="${q.id}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [p.currentBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The paragraph and character offsets the selection covers, among the editable runs. */
  const selection = (): { para: DPara; from: number; to: number } | null => {
    const sl = window.getSelection();
    if (!sl || sl.rangeCount === 0 || !root.current) return null;
    const range = sl.getRangeAt(0);
    const host = ((range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null)?.closest<HTMLElement>("[data-pid]");
    if (!host || !root.current.contains(host)) return null;
    const para = m.paras.find((q) => q.id === host.dataset["pid"]);
    if (!para || para.why !== undefined) return null;
    const offset = (node: Node, off: number): number => {
      let total = 0;
      for (const s of Array.from(host.querySelectorAll<HTMLElement>("[data-r]"))) {
        if (s.contains(node)) {
          const pre = document.createRange();
          pre.setStart(s, 0);
          pre.setEnd(node, off);
          return total + pre.toString().length;
        }
        total += (s.textContent ?? "").length;
      }
      return total;
    };
    return { para, from: offset(range.startContainer, range.startOffset), to: offset(range.endContainer, range.endOffset) };
  };
  const fmt = (f: "b" | "i" | "u"): void => {
    const s = selection();
    if (!s) return;
    toggleFormat(m, s.para, Math.min(s.from, s.to), Math.max(s.from, s.to), f);
    p.onChange();
    p.onRedraw();
  };
  const head = (level: number): void => {
    const s = selection();
    if (!s) return;
    if (setHeading(m, s.para, level)) {
      p.onChange();
      p.onRedraw();
    }
  };
  const levels = Object.keys(m.headingStyles).map(Number).sort();
  const w = m.page.w * z;
  const bar = editable
    ? createElement(
        "div",
        { className: "vww-fmt", "data-testid": "vww-fmt" },
        createElement("button", { "aria-label": "Bold", "data-testid": "vww-bold", onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: () => fmt("b") }, "Bold"),
        createElement("button", { "aria-label": "Italic", "data-testid": "vww-italic", onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: () => fmt("i") }, "Italic"),
        createElement("button", { "aria-label": "Underline", "data-testid": "vww-underline", onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: () => fmt("u") }, "Underline"),
        levels.length > 0
          ? createElement(
              "select",
              { "aria-label": "Text style", "data-testid": "vww-style", value: "", onMouseDown: (e: MouseEvent) => void e, onChange: (e: { target: { value: string } }) => head(Number(e.target.value)) },
              createElement("option", { value: "", disabled: true }, "Style"),
              createElement("option", { value: "0" }, "Body text"),
              ...levels.map((l) => createElement("option", { key: l, value: String(l) }, `Heading ${l}`)),
            )
          : null,
        createElement("span", { className: "vww-why" }, "A paragraph with tracked changes or a field is kept as it is."),
      )
    : p.why !== undefined && p.edit
      ? createElement("div", { className: "vww-fmt" }, createElement("span", { className: "vww-why", "data-testid": "vww-why" }, p.why))
      : null;
  // the page is built again only when something that shows changes: typing edits the file's model and the DOM already shows it, so a redraw then would move the caret
  const card = useMemo(
    () =>
      createElement(
        "div",
        { className: "vww-card", style: { width: w * PX, paddingLeft: m.page.ml * z * PX, paddingRight: m.page.mr * z * PX, paddingTop: m.page.mt * z * PX * 0.7, paddingBottom: m.page.mb * z * PX * 0.7 }, "data-testid": "vww-card" },
        ...(m.header.length > 0 ? [createElement("div", { key: "h", "data-testid": "vww-header" }, ...m.header.map((q) => paraEl(q, true)))] : []),
        ...blocks(m.blocks),
        ...(m.footnotes.length > 0
          ? [createElement("div", { key: "fn", className: "vww-fn", "data-testid": "vww-footnotes" }, ...m.footnotes.map((f, i) => createElement("div", { key: f.id }, `${i + 1}. ${f.paras.map((q) => q.text).join(" ")}`)))]
          : []),
        ...(m.footer.length > 0 ? [createElement("div", { key: "f", "data-testid": "vww-footer", style: { marginTop: 24 } }, ...m.footer.map((q) => paraEl(q, true)))] : []),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, p.rev, z, editable, p.decor, order],
  );
  return createElement(
    "div",
    { className: "vww", "data-testid": "vww", "data-paras": m.paras.length },
    bar,
    createElement("div", { className: "vww-scroll", ref: root, "data-testid": "vww-scroll" }, card),
  );
}
export type { DRun };
