// A PowerPoint file as slides (web): a filmstrip of every slide and the current slide drawn large, each shape where the file puts it. Find marks the matches on the slides, a comment or a Redact for AI
// mark pins to a place on a slide (the same area anchors a PDF page takes), and Present shows a slide full screen with the arrow keys. In Edit the words of a text box or a table cell are typed into and
// written back through ui/Viewer/rich/pptx.ts. Not drawn: see pptx.ts.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { injectCss } from "../../theme/css.ts";
import { setParaRuns } from "./pptx.ts";
import type { PPara, PShape, PSlide, PptxModel } from "./pptx.ts";
import type { PdfMark, PdfPin } from "./PdfPages.tsx";
import { unitBox } from "./pdf-model.ts";
import type { DecorRange } from "./types.ts";

export interface SlideViewProps {
  model: PptxModel;
  rev: number;
  /** 1-based, from the viewer's page control. */
  slide: number;
  onSlide: (n: number) => void;
  zoom: number;
  edit: boolean;
  why?: string;
  thumbs: boolean;
  imageUrl: (path: string) => string | undefined;
  decor: (block: number) => DecorRange[];
  tool: "comment" | "redact" | null;
  pins: readonly PdfPin[];
  marks: readonly PdfMark[];
  onChange: () => void;
  onArea: (a: {
    tool: "comment" | "redact";
    page: number;
    box: { x: number; y: number; w: number; h: number };
    text: string;
  }) => void;
}

const CSS = `
.vws{position:relative;flex:1;min-height:0;display:flex;background:var(--sunk,#eee)}
.vws-strip{width:148px;flex:none;overflow-y:auto;padding:12px 10px;border-right:1px solid var(--line,rgba(0,0,0,.08));background:var(--win,#fff)}
.vws-th{display:block;width:100%;margin:0 0 12px;padding:0;border:0;background:none;cursor:pointer;color:var(--ink-3,#777);font:600 11px system-ui;text-align:left}
.vws-th .vws-slide{box-shadow:0 0 0 1px var(--line,rgba(0,0,0,.14));border-radius:4px;pointer-events:none}
.vws-th[data-on="1"] .vws-slide{box-shadow:0 0 0 2px var(--accent,#5b5bd6)}
.vws-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto}
.vws-stage{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 20px;min-height:0}
.vws-slide{position:relative;background:#fff;color:#111;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.2)}
.vws-sh{position:absolute;box-sizing:border-box;overflow:visible}
.vws-sh img{overflow:hidden}
.vws-sh p{margin:0;white-space:pre-wrap;outline:0}
.vws-sh[data-edit="1"] p:focus{background:rgba(91,91,214,.08)}
.vws-sh table{border-collapse:collapse;width:100%;height:100%}
.vws-sh td{border:1px solid #bbb;padding:2px 6px;vertical-align:middle}
.vws-sh mark.vwf{background:rgba(255,204,0,.55);color:inherit}
.vws-sh mark.vwf-on{background:rgba(255,140,0,.75);outline:2px solid rgba(255,140,0,.9)}
.vws-foot{display:flex;align-items:center;justify-content:center;gap:12px;padding:6px;color:var(--ink-3,#777);font:12px system-ui}
.vws-foot button{border:0;background:none;color:var(--ink-2,#444);padding:4px 9px;border-radius:6px;cursor:pointer;font:600 12px system-ui}
.vws-foot button:hover{background:var(--win,#fff)}
.vws-pin{position:absolute;z-index:4;pointer-events:none;border:1.5px solid var(--accent,#5b5bd6);background:color-mix(in srgb,var(--accent,#5b5bd6) 10%,transparent);border-radius:3px}
.vws-pin b{position:absolute;left:-9px;top:-9px;min-width:18px;height:18px;border-radius:9px;background:var(--accent,#5b5bd6);color:#fff;font:700 10.5px/18px system-ui;text-align:center}
.vws-drag{position:absolute;z-index:5;pointer-events:none;border:1.5px dashed var(--accent,#5b5bd6);background:color-mix(in srgb,var(--accent,#5b5bd6) 12%,transparent)}
.vws-note{position:absolute;z-index:9;padding:4px;border-radius:10px;background:var(--raised,#fff);box-shadow:0 6px 24px rgba(0,0,0,.18),0 0 0 1px var(--line,rgba(0,0,0,.08))}
.vws-note input{border:0;outline:0;background:none;font:13px system-ui;min-width:200px;padding:6px 8px;color:var(--ink,#111)}
.vws-full{position:fixed;inset:0;z-index:99999;background:#000;display:flex;align-items:center;justify-content:center}
.vws-tool .vws-slide{cursor:crosshair}
`;

function pieces(len: number, ds: readonly DecorRange[]): { s: number; e: number; d: DecorRange[] }[] {
  const cuts = new Set<number>([0, len]);
  for (const d of ds) {
    cuts.add(Math.max(0, Math.min(len, d.s)));
    cuts.add(Math.max(0, Math.min(len, d.e)));
  }
  const xs = [...cuts].sort((a, b) => a - b);
  const out: { s: number; e: number; d: DecorRange[] }[] = [];
  for (let i = 0; i + 1 < xs.length; i++)
    out.push({ s: xs[i]!, e: xs[i + 1]!, d: ds.filter((d) => d.s <= xs[i]! && d.e >= xs[i + 1]!) });
  return out;
}

interface DrawOpts {
  /** A filmstrip thumbnail: its test id differs from the slide on show. */
  thumb?: boolean;
  edit: boolean;
  decor: DecorRange[];
  onInput?: (s: PSlide, p: PPara, texts: string[]) => void;
}

/** One slide drawn at `width` pixels. */
function slideEl(
  m: PptxModel,
  s: PSlide,
  width: number,
  o: DrawOpts,
  imageUrl: (p: string) => string | undefined,
  extra: ReactNode[] = [],
  handlers: Record<string, unknown> = {},
): ReactElement {
  const ratio = width / (m.w / 12700);
  const height = (width * m.h) / m.w;
  let at = 0;
  const para = (pp: PPara, sh: PShape, key: string): ReactElement => {
    const start = at;
    if (pp.text !== "") at += pp.text.length + 1;
    let run0 = 0;
    const els = pp.runs.map((r, ri) => {
      const a = run0;
      run0 += r.text.length;
      const ds = o.decor
        .map((d) => ({ ...d, s: d.s - start - a, e: d.e - start - a }))
        .filter((d) => d.e > 0 && d.s < r.text.length && d.kind !== "comment");
      const parts = o.edit ? [{ s: 0, e: r.text.length, d: [] as DecorRange[] }] : pieces(r.text.length, ds);
      const inner = parts.map((pc, k) => {
        const t = r.text.slice(pc.s, pc.e);
        const f = pc.d.find((x) => x.kind === "find" || x.kind === "find-on");
        return f
          ? createElement(
              "mark",
              {
                key: k,
                className: f.kind === "find-on" ? "vwf vwf-on" : "vwf",
                "data-find": f.kind === "find-on" ? "current" : "match",
              },
              t,
            )
          : t;
      });
      return createElement(
        "span",
        {
          key: ri,
          "data-r": ri,
          style: {
            fontSize: (r.sz ?? (sh.title ? 36 : 18)) * ratio,
            fontWeight: r.b || sh.title ? 700 : 400,
            fontStyle: r.i ? "italic" : "normal",
            textDecoration: r.u ? "underline" : "none",
            color: r.color ?? (sh.fill ? "#fff" : "#111"),
          },
        },
        ...inner,
      );
    });
    return createElement(
      "p",
      {
        key,
        contentEditable: o.edit,
        suppressContentEditableWarning: true,
        style: {
          textAlign: pp.align as never,
          ...(pp.bullet ? { paddingLeft: 18 * ratio * 2, textIndent: -18 * ratio * 2 } : {}),
          minHeight: `${18 * ratio}px`,
        },
        onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && e.preventDefault(),
        onInput: (e: { currentTarget: HTMLElement }) => {
          const spans = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-r]"));
          o.onInput?.(
            s,
            pp,
            pp.runs.map((_, i) => spans.find((x) => x.dataset["r"] === String(i))?.textContent ?? ""),
          );
        },
      },
      ...(pp.bullet ? [createElement("span", { key: "b", contentEditable: false }, "• ")] : []),
      ...els,
    );
  };
  const shapes = s.shapes.map((sh, i) => {
    const box = {
      left: `${(sh.x / m.w) * 100}%`,
      top: `${(sh.y / m.h) * 100}%`,
      width: `${(sh.w / m.w) * 100}%`,
      height: `${(sh.h / m.h) * 100}%`,
    };
    if (sh.kind === "pic") {
      const url = sh.pic ? imageUrl(sh.pic.path) : undefined;
      return createElement(
        "div",
        { key: i, className: "vws-sh", style: box },
        url
          ? createElement("img", {
              src: url,
              alt: sh.pic!.alt,
              style: { width: "100%", height: "100%", objectFit: "contain" },
              "data-testid": "vws-img",
            })
          : null,
      );
    }
    if (sh.kind === "table")
      return createElement(
        "div",
        { key: i, className: "vws-sh", style: box, "data-edit": o.edit ? "1" : "0" },
        createElement(
          "table",
          null,
          createElement(
            "tbody",
            null,
            ...(sh.table ?? []).map((row, ri) =>
              createElement(
                "tr",
                { key: ri },
                ...row.map((cell, ci) =>
                  createElement("td", { key: ci }, ...cell.map((pp, k) => para(pp, sh, `${k}`))),
                ),
              ),
            ),
          ),
        ),
      );
    return createElement(
      "div",
      {
        key: i,
        className: "vws-sh",
        style: {
          ...box,
          ...(sh.fill ? { background: sh.fill } : {}),
          padding: `${6 * ratio}px ${10 * ratio}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: sh.title ? "center" : "flex-start",
        },
        "data-edit": o.edit ? "1" : "0",
      },
      ...sh.paras.map((pp, k) => para(pp, sh, `${k}`)),
    );
  });
  return createElement(
    "div",
    {
      className: "vws-slide",
      style: { width, height },
      "data-testid": o.thumb ? `vws-thumbslide-${s.n}` : `vws-slide-${s.n}`,
      "data-w": Math.round(width),
      ...handlers,
    },
    ...shapes,
    ...extra,
  );
}

export function SlideView(p: SlideViewProps): ReactElement {
  const m = p.model;
  const main = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  const [present, setPresent] = useState(false);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const [asking, setAsking] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    injectCss(document as never, "vy-viewer-slides", CSS);
  }, []);
  useEffect(() => {
    const el = main.current;
    if (!el) return undefined;
    const measure = (): void => setW(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const cur = m.slides[Math.min(Math.max(p.slide, 1), m.slides.length) - 1]!;
  const idx = cur.n;
  const editable = p.edit && p.why === undefined;
  const slideW = Math.max(240, Math.min(w - 40, 1100) * p.zoom);
  const decor = p.decor(idx - 1);
  const sig = JSON.stringify(decor);
  const input = (s: PSlide, pp: PPara, texts: string[]): void => {
    setParaRuns(s, pp, texts);
    p.onChange();
  };

  useEffect(() => {
    if (!present) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPresent(false);
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
        p.onSlide(Math.min(m.slides.length, idx + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") p.onSlide(Math.max(1, idx - 1));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [present, idx, m.slides.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const pins = p.pins
    .filter((x) => x.page === idx)
    .map((x) =>
      createElement(
        "div",
        {
          key: x.id,
          className: "vws-pin",
          "data-testid": `vwp-pin-${x.n}`,
          style: {
            left: `${x.box.x * 100}%`,
            top: `${x.box.y * 100}%`,
            width: `${x.box.w * 100}%`,
            height: `${x.box.h * 100}%`,
          },
          title: x.text,
        },
        createElement("b", null, String(x.n)),
      ),
    );
  const marks = p.marks
    .filter((x) => x.page === idx)
    .map((x) =>
      createElement("div", {
        key: x.id,
        "data-rxbox": "1",
        "data-mark": x.id,
        "data-testid": `vwp-rbox-${x.id}`,
        style: {
          position: "absolute",
          zIndex: 3,
          pointerEvents: "none",
          left: `${x.box.x * 100}%`,
          top: `${x.box.y * 100}%`,
          width: `${x.box.w * 100}%`,
          height: `${x.box.h * 100}%`,
        },
      }),
    );
  const live = drag ? unitBox(drag.a, drag.b) : null;
  const dragEl = live
    ? [
        createElement("div", {
          key: "drag",
          className: "vws-drag",
          style: {
            left: `${live.x * 100}%`,
            top: `${live.y * 100}%`,
            width: `${live.w * 100}%`,
            height: `${live.h * 100}%`,
          },
        }),
      ]
    : [];
  const noteEl = asking
    ? [
        createElement(
          "div",
          {
            key: "note",
            className: "vws-note",
            style: { left: `${asking.x * 100}%`, top: `${(asking.y + asking.h) * 100}%` },
            "data-testid": "vwp-note",
          },
          createElement("input", {
            autoFocus: true,
            placeholder: "Comment on this",
            "aria-label": "Comment on this place",
            "data-testid": "vwp-note-input",
            onKeyDown: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
              if (e.key === "Escape") setAsking(null);
              if (e.key === "Enter" && e.currentTarget.value.trim() !== "") {
                p.onArea({ tool: "comment", page: idx, box: asking, text: e.currentTarget.value.trim() });
                setAsking(null);
              }
            },
          }),
        ),
      ]
    : [];
  // the pins and marks arrive as new arrays on every render of the screen; only a change in what they say redraws the slide (a redraw while typing would move the caret)
  const pinSig = JSON.stringify([p.pins, p.marks]);
  const stage = useMemo(
    () =>
      slideEl(
        m,
        cur,
        slideW,
        { edit: editable, decor, onInput: input },
        p.imageUrl,
        [...pins, ...marks, ...dragEl, ...noteEl],
        {
          onMouseDown: (e: MouseEvent & { currentTarget: HTMLElement }) => {
            if (p.tool === null) return;
            e.preventDefault();
            const u = unit(e);
            setDrag({ a: u, b: u });
          },
          onMouseMove: (e: MouseEvent & { currentTarget: HTMLElement }) => drag && setDrag({ a: drag.a, b: unit(e) }),
          onMouseUp: (e: MouseEvent & { currentTarget: HTMLElement }) => {
            if (!drag || p.tool === null) return;
            const b = unitBox(drag.a, unit(e)) ?? {
              x: Math.max(0, drag.a[0] - 0.01),
              y: Math.max(0, drag.a[1] - 0.01),
              w: 0.02,
              h: 0.02,
            };
            setDrag(null);
            if (p.tool === "redact") p.onArea({ tool: "redact", page: idx, box: b, text: "" });
            else setAsking(b);
          },
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, idx, slideW, editable, sig, p.rev, pinSig, drag, asking, p.tool],
  );
  const strip = p.thumbs
    ? createElement(
        "div",
        { className: "vws-strip", "data-testid": "vws-strip" },
        ...m.slides.map((s) =>
          createElement(
            "button",
            {
              key: s.n,
              className: "vws-th",
              "data-on": s.n === idx ? "1" : "0",
              "aria-label": `Slide ${s.n}`,
              "data-testid": `vws-thumb-${s.n}`,
              onClick: () => p.onSlide(s.n),
            },
            slideEl(m, s, 120, { thumb: true, edit: false, decor: [] }, p.imageUrl),
            `${s.n}`,
          ),
        ),
      )
    : null;
  return createElement(
    "div",
    {
      className: `vws${p.tool !== null ? " vws-tool" : ""}`,
      "data-testid": "vws",
      "data-slides": m.slides.length,
      "data-current": idx,
    },
    strip,
    createElement(
      "div",
      { className: "vws-main", ref: main },
      createElement("div", { className: "vws-stage" }, stage),
      createElement(
        "div",
        { className: "vws-foot" },
        createElement("span", { "data-testid": "vws-count" }, `Slide ${idx} of ${m.slides.length}`),
        createElement(
          "button",
          { "aria-label": "Present", "data-testid": "vws-present", onClick: () => setPresent(true) },
          "Present",
        ),
        editable ? null : null,
      ),
    ),
    present
      ? createElement(
          "div",
          {
            className: "vws-full",
            "data-testid": "vws-full",
            onClick: () => p.onSlide(Math.min(m.slides.length, idx + 1)),
          },
          slideEl(
            m,
            cur,
            Math.min(window.innerWidth, (window.innerHeight * m.w) / m.h),
            { edit: false, decor: [] },
            p.imageUrl,
            [],
            { "data-present": "1" },
          ),
        )
      : null,
  );
}
