// The PDF as its pages (web). pdf.js draws each page near the screen to a canvas with a transparent text layer above it, so the words select, copy and find like text. Pages far from the
// screen give their canvas back, so a 500-page file opens on its first page at once and scrolls without growing. Everything a person does to a page goes through the viewer's own pieces:
// Find (the viewer's box and its count), a comment or a Redact for AI mark on an area or a selection (the callbacks the viewer already has for pictures), Back, History and Ask.
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { injectCss } from "../../theme/css.ts";
import { loadPdfjs } from "./vendor.ts";
import type { PdfDoc, PdfLib, PdfPage } from "./vendor.ts";
import {
  PAGE_GAP,
  currentPage,
  fitScale,
  itemHits,
  pageOffsets,
  pageText,
  pagesToDraw,
  pdfFailureWords,
  unitBox,
} from "./pdf-model.ts";

export interface PdfPin {
  id: string;
  n: number;
  page: number;
  box: { x: number; y: number; w: number; h: number };
  text: string;
}
export interface PdfMark {
  id: string;
  page: number;
  box: { x: number; y: number; w: number; h: number };
  label?: string;
}
export interface PdfPagesProps {
  /** The file's bytes (read with the person's sign-in). pdf.js is given a copy, so this stays whole. */
  data: Uint8Array;
  /** 1 is the column's width; the viewer's zoom buttons change it. */
  zoom: number;
  find: string;
  /** Which match of the viewer's Find is the current one, and the page it is on (1-based, from the viewer's blocks). */
  current: { page: number; occurrence: number } | null;
  tool: "comment" | "redact" | null;
  pins: readonly PdfPin[];
  marks: readonly PdfMark[];
  thumbs: boolean;
  /** Ask the body to scroll to this page; `n` changes on every request, so asking for the same page twice works. */
  jump: { page: number; n: number } | null;
  onPages: (info: { count: number }) => void;
  onPage: (page: number) => void;
  /** The text of each page, as it is read (all of them at the end), for the viewer's Find. */
  onText: (pages: readonly string[], done: boolean) => void;
  onFailed?: (words: string) => void;
  onArea: (a: {
    tool: "comment" | "redact";
    page: number;
    box: { x: number; y: number; w: number; h: number };
    text: string;
    quote?: string;
  }) => void;
  onSelect?: (a: { quote: string; page: number; box: { x: number; y: number; w: number; h: number } }) => void;
  onZoom: (z: number) => void;
}

const CSS = `
.vwp{position:relative;flex:1;min-height:0;display:flex;background:var(--sunk,#eee);outline:0}
.vwp-thumbs{width:116px;flex:none;overflow-y:auto;padding:10px 8px;border-right:1px solid var(--line,rgba(0,0,0,.08));background:var(--win,#fff)}
.vwp-thumb{display:block;width:100%;margin:0 0 10px;padding:0;border:0;background:none;cursor:pointer;text-align:center;color:var(--ink-3,#777);font:600 11px system-ui}
.vwp-thumb canvas,.vwp-thumb i{display:block;margin:0 auto 4px;border-radius:3px;box-shadow:0 0 0 1px var(--line,rgba(0,0,0,.12));background:#fff}
.vwp-thumb[data-on="1"] canvas,.vwp-thumb[data-on="1"] i{box-shadow:0 0 0 2px var(--accent,#5b5bd6)}
.vwp-scroll{position:relative;flex:1;min-width:0;overflow:auto;-webkit-overflow-scrolling:touch}
.vwp-page{position:absolute;left:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);overflow:hidden}
.vwp-page canvas{position:absolute;left:0;top:0;width:100%;height:100%}
.vwp-text{position:absolute;inset:0;overflow:hidden;line-height:1;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:2}
.vwp-text span,.vwp-text br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0}
.vwp-text ::selection{background:color-mix(in srgb,var(--accent,#5b5bd6) 32%,transparent)}
.vwp-text mark.vwf{color:transparent;background:rgba(255,204,0,.45);border-radius:2px}
.vwp-text mark.vwf-on{background:rgba(255,140,0,.65);outline:2px solid rgba(255,140,0,.9)}
.vwp-tool .vwp-text{pointer-events:none}
.vwp-tool .vwp-page{cursor:crosshair}
.vwp-pin{position:absolute;z-index:4;pointer-events:none;border:1.5px solid var(--accent,#5b5bd6);background:color-mix(in srgb,var(--accent,#5b5bd6) 10%,transparent);border-radius:3px}
.vwp-pin b{position:absolute;left:-9px;top:-9px;min-width:18px;height:18px;border-radius:9px;background:var(--accent,#5b5bd6);color:#fff;font:700 10.5px/18px system-ui;text-align:center}
.vwp-mark{position:absolute;z-index:3;pointer-events:none}
.vwp-drag{position:absolute;z-index:5;pointer-events:none;border:1.5px dashed var(--accent,#5b5bd6);background:color-mix(in srgb,var(--accent,#5b5bd6) 12%,transparent)}
.vwp-bar{position:absolute;z-index:9;display:flex;gap:2px;padding:4px;border-radius:10px;background:var(--raised,#fff);box-shadow:0 6px 24px rgba(0,0,0,.18),0 0 0 1px var(--line,rgba(0,0,0,.08))}
.vwp-bar button{border:0;background:none;padding:6px 10px;border-radius:7px;font:600 12.5px system-ui;color:var(--ink,#111);cursor:pointer}
.vwp-bar button:hover{background:var(--sunk,#eee)}
.vwp-bar input{border:0;outline:0;background:none;font:13px system-ui;color:var(--ink,#111);min-width:200px;padding:6px 8px}
.vwp-msg{margin:auto;color:var(--ink-3,#777);font:14px system-ui;padding:24px;text-align:center}
`;

const W = (n: number): number => Math.round(n * 100) / 100;

/** The thumbnails column: small pictures of the pages near the visible one, drawn the same lazy way. */
function Thumbs(p: {
  doc: PdfDoc;
  count: number;
  ratio: number;
  page: number;
  onPick: (n: number) => void;
}): ReactElement {
  const col = useRef<HTMLDivElement | null>(null);
  const done = useRef(new Set<number>());
  const draw = useCallback(
    async (n: number, host: HTMLElement): Promise<void> => {
      if (done.current.has(n)) return;
      done.current.add(n);
      try {
        const page = await p.doc.getPage(n);
        const vp = page.getViewport({ scale: 100 / page.getViewport({ scale: 1 }).width });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        host.querySelector("i")?.replaceWith(c);
      } catch {
        done.current.delete(n);
      }
    },
    [p.doc],
  );
  useEffect(() => {
    const el = col.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es)
          if (e.isIntersecting) {
            const h = e.target as HTMLElement;
            void draw(Number(h.dataset["n"]), h);
          }
      },
      { root: el, rootMargin: "300px" },
    );
    el.querySelectorAll<HTMLElement>("[data-n]").forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [draw, p.count]);
  useEffect(() => {
    col.current?.querySelector<HTMLElement>(`[data-n="${p.page}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.page]);
  const items: ReactElement[] = [];
  for (let n = 1; n <= p.count; n++)
    items.push(
      createElement(
        "button",
        {
          key: n,
          className: "vwp-thumb",
          "data-n": n,
          "data-on": n === p.page ? "1" : "0",
          "aria-label": `Page ${n}`,
          "data-testid": `vwp-thumb-${n}`,
          onClick: () => p.onPick(n),
        },
        createElement("i", { style: { width: 100, height: Math.round(100 * p.ratio) } }),
        String(n),
      ),
    );
  return createElement("div", { className: "vwp-thumbs", ref: col, "data-testid": "vwp-thumbs" }, ...items);
}

export function PdfPages(p: PdfPagesProps): ReactElement {
  const [lib, setLib] = useState<PdfLib | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [sizes, setSizes] = useState<readonly { w: number; h: number }[]>([]);
  const [colW, setColW] = useState(800);
  const [view, setView] = useState({ top: 0, h: 800 });
  const [drag, setDrag] = useState<{ page: number; a: [number, number]; b: [number, number] } | null>(null);
  const [bar, setBar] = useState<{
    x: number;
    y: number;
    quote: string;
    page: number;
    box: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const askQuote = useRef("");
  const scroller = useRef<HTMLDivElement | null>(null);
  const frames = useRef(new Map<number, HTMLDivElement>());
  const drawn = useRef(new Map<number, { scale: number; token: number }>());
  const tokens = useRef(0);
  const sizesRef = useRef<{ w: number; h: number }[]>([]);
  const pageTexts = useRef<string[]>([]);

  useEffect(() => {
    injectCss(document as never, "vy-viewer-pdf", CSS);
  }, []);

  // open the file
  useEffect(() => {
    let live = true;
    let task: { destroy(): Promise<void> } | null = null;
    setDoc(null);
    setFailed(null);
    setSizes([]);
    drawn.current.clear();
    pageTexts.current = [];
    void (async () => {
      try {
        const l = await loadPdfjs();
        if (!live) return;
        setLib(l);
        const t = l.getDocument({ data: p.data.slice() });
        task = t;
        const d = await t.promise;
        if (!live) return void d.destroy();
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        sizesRef.current = Array.from({ length: d.numPages }, () => ({ w: vp.width, h: vp.height }));
        setSizes(sizesRef.current.slice());
        setDoc(d);
        p.onPages({ count: d.numPages });
        // the words of every page, in the background, a page at a time, so Find works on the whole file and a scan is known to have none
        const texts: string[] = Array.from({ length: d.numPages }, () => "");
        for (let n = 1; n <= d.numPages && live; n++) {
          const pg = n === 1 ? first : await d.getPage(n);
          const v = pg.getViewport({ scale: 1 });
          sizesRef.current[n - 1] = { w: v.width, h: v.height };
          const tc = await pg.getTextContent();
          texts[n - 1] = pageText(tc.items.map((i) => i.str));
          pageTexts.current = texts;
          if (n % 20 === 0 || n === d.numPages) {
            setSizes(sizesRef.current.slice());
            p.onText(texts.slice(), n === d.numPages);
          }
          if (n > 1) pg.cleanup();
        }
      } catch (e) {
        if (live) {
          setFailed(pdfFailureWords(e));
          p.onFailed?.(pdfFailureWords(e));
        }
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
    // the bytes are the file; new bytes are a new document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.data]);

  // the column's width and the scroll position
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = (): void => {
      setColW(el.clientWidth);
      setView((v) => ({ top: el.scrollTop, h: el.clientHeight || v.h }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [doc, p.thumbs]);

  const base = sizes[0] ?? { w: 612, h: 792 };
  const scale = fitScale(Math.max(200, colW - 32), base.w) * p.zoom;
  const heights = useMemo(() => sizes.map((s) => s.h * scale), [sizes, scale]);
  const { tops, total } = useMemo(() => pageOffsets(heights), [heights]);
  const range = pagesToDraw(tops, heights, view.top, view.h);
  const page = currentPage(tops, heights, view.top, view.h);

  useEffect(() => p.onPage(page), [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // jump to a page
  useEffect(() => {
    if (p.jump === null || scroller.current === null) return;
    const t = tops[p.jump.page - 1];
    if (t !== undefined) scroller.current.scrollTop = Math.max(0, t - PAGE_GAP);
  }, [p.jump?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Mark the matches of Find in a drawn page's text layer, and the current one. */
  const markFind = useCallback(
    (n: number): void => {
      const root = frames.current.get(n)?.querySelector<HTMLElement>(".vwp-text");
      if (!root) return;
      const spans = Array.from(root.querySelectorAll<HTMLElement>("span"));
      for (const sp of spans) if (sp.dataset["orig"] !== undefined) sp.textContent = sp.dataset["orig"];
      const q = p.find.trim();
      if (q === "") return;
      const texts = spans.map((sp) => sp.textContent ?? "");
      const hits = itemHits(texts, q);
      const curOcc = p.current !== null && p.current.page === n ? p.current.occurrence : -1;
      const byItem = new Map<number, { at: number; k: number }[]>();
      hits.forEach((h, k) => byItem.set(h.item, [...(byItem.get(h.item) ?? []), { at: h.at, k }]));
      for (const [i, list] of byItem) {
        const sp = spans[i]!;
        const t = texts[i]!;
        sp.dataset["orig"] = t;
        sp.textContent = "";
        let at = 0;
        for (const h of list) {
          if (h.at > at) sp.append(t.slice(at, h.at));
          const m = document.createElement("mark");
          m.className = h.k === curOcc ? "vwf vwf-on" : "vwf";
          m.dataset["find"] = h.k === curOcc ? "current" : "match";
          m.textContent = t.slice(h.at, h.at + q.length);
          sp.append(m);
          at = h.at + q.length;
        }
        if (at < t.length) sp.append(t.slice(at));
      }
      if (curOcc >= 0) root.querySelector(".vwf-on")?.scrollIntoView({ block: "center", inline: "nearest" });
    },
    [p.find, p.current],
  );

  // draw the pages near the screen, give back the others
  useEffect(() => {
    if (!doc || !lib) return;
    const keep = new Set<number>();
    for (let i = range.from; i <= range.to; i++) keep.add(i + 1);
    for (const [n, st] of Array.from(drawn.current)) {
      if (!keep.has(n) || st.scale !== scale) {
        const f = frames.current.get(n);
        if (f) f.querySelectorAll("canvas,.vwp-text").forEach((c) => c.remove());
        drawn.current.delete(n);
      }
    }
    for (const n of keep) {
      const f = frames.current.get(n);
      if (!f || drawn.current.has(n)) continue;
      const token = ++tokens.current;
      drawn.current.set(n, { scale, token });
      void (async () => {
        const pg: PdfPage = await doc.getPage(n);
        if (drawn.current.get(n)?.token !== token) return;
        const vp = pg.getViewport({ scale });
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width * ratio);
        c.height = Math.ceil(vp.height * ratio);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.scale(ratio, ratio);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        if (drawn.current.get(n)?.token !== token) return;
        f.insertBefore(c, f.firstChild);
        const tl = document.createElement("div");
        tl.className = "vwp-text";
        tl.style.setProperty("--scale-factor", String(vp.scale));
        f.appendChild(tl);
        try {
          await new lib.TextLayer({ textContentSource: pg.streamTextContent(), container: tl, viewport: vp }).render();
        } catch {
          /* a page whose words cannot be read is still drawn */
        }
        if (drawn.current.get(n)?.token === token) markFind(n);
      })().catch(() => drawn.current.delete(n));
    }
  }, [doc, lib, range.from, range.to, scale, sizes, markFind]);

  // Find: re-mark the drawn pages; bring the current match's page near the screen first
  useEffect(() => {
    for (const n of drawn.current.keys()) markFind(n);
  }, [markFind]);
  useEffect(() => {
    if (p.current === null || scroller.current === null) return;
    const t = tops[p.current.page - 1];
    const h = heights[p.current.page - 1] ?? 0;
    if (t === undefined) return;
    const el = scroller.current;
    if (t < el.scrollTop || t + h > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, t - PAGE_GAP);
  }, [p.current?.page, p.current?.occurrence, p.find]); // eslint-disable-line react-hooks/exhaustive-deps

  // a selection of words offers Comment and Redact; a drag with a tool picked marks an area
  const unit = (n: number, e: { clientX: number; clientY: number }): [number, number] | null => {
    const f = frames.current.get(n);
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const pageAt = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-page]") as HTMLElement | null;
    return el ? Number(el.dataset["page"]) : null;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (p.tool !== null) return;
    setTimeout(() => {
      const sl = window.getSelection();
      if (!sl || sl.isCollapsed || sl.rangeCount === 0) return void setBar(null);
      const range = sl.getRangeAt(0);
      const start = (
        range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement
      ) as HTMLElement | null;
      const n = pageAt(start);
      const f = n === null ? undefined : frames.current.get(n);
      if (n === null || !f) return void setBar(null);
      const fr = f.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) return void setBar(null);
      const l = Math.min(...rects.map((r) => r.left));
      const t = Math.min(...rects.map((r) => r.top));
      const r = Math.max(...rects.map((q) => q.right));
      const b = Math.max(...rects.map((q) => q.bottom));
      const box = unitBox(
        [(l - fr.left) / fr.width, (t - fr.top) / fr.height],
        [(r - fr.left) / fr.width, (b - fr.top) / fr.height],
      );
      const sc = scroller.current?.getBoundingClientRect();
      if (!box || !sc) return void setBar(null);
      setBar({
        x: Math.max(8, Math.min(sc.width - 330, e.clientX - sc.left - 60)),
        y: Math.max(4, t - sc.top - 46),
        quote: sl.toString().replace(/\s+/g, " ").trim().slice(0, 400),
        page: n,
        box,
      });
    }, 0);
  };
  const down = (e: MouseEvent): void => {
    if (p.tool === null) return;
    const n = pageAt(e.target);
    if (n === null) return;
    const u = unit(n, e);
    if (u) setDrag({ page: n, a: u, b: u });
    e.preventDefault();
  };
  const move = (e: MouseEvent): void => {
    if (!drag) return;
    const u = unit(drag.page, e);
    if (u) setDrag({ ...drag, b: u });
  };
  const up = (e: MouseEvent): void => {
    if (!drag || p.tool === null) return;
    const u = unit(drag.page, e) ?? drag.b;
    const box = unitBox(drag.a, u) ?? {
      x: Math.max(0, drag.a[0] - 0.01),
      y: Math.max(0, drag.a[1] - 0.01),
      w: 0.02,
      h: 0.02,
    };
    const pageNo = drag.page;
    setDrag(null);
    if (p.tool === "redact") p.onArea({ tool: "redact", page: pageNo, box, text: "" });
    else {
      askQuote.current = "";
      setAsking(`${pageNo}:${JSON.stringify(box)}`);
    }
  };

  // pinch to zoom on a phone
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    let d0 = 0;
    let z0 = 1;
    const dist = (t: TouchList): number =>
      Math.hypot((t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0), (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0));
    const ts = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        d0 = dist(e.touches);
        z0 = p.zoom;
      }
    };
    const tm = (e: TouchEvent): void => {
      if (e.touches.length === 2 && d0 > 0) {
        e.preventDefault();
        p.onZoom(Math.max(0.5, Math.min(4, Math.round(z0 * (dist(e.touches) / d0) * 100) / 100)));
      }
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
    };
  }, [p.zoom, p.onZoom, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed !== null)
    return createElement(
      "div",
      { className: "vwp", "data-testid": "vwp-failed" },
      createElement("div", { className: "vwp-msg" }, failed),
    );
  if (!doc)
    return createElement(
      "div",
      { className: "vwp", "data-testid": "vwp-loading" },
      createElement("div", { className: "vwp-msg" }, "Opening the file"),
    );

  const frame = (n: number): ReactElement => {
    const s = sizes[n - 1] ?? base;
    const w = W(s.w * scale);
    const h = W(s.h * scale);
    const near = n - 1 >= range.from && n - 1 <= range.to;
    const pins = p.pins.filter((x) => x.page === n);
    const marks = p.marks.filter((x) => x.page === n);
    const live = drag !== null && drag.page === n ? drag : null;
    const box = (b: { x: number; y: number; w: number; h: number }): Record<string, string> => ({
      left: `${b.x * 100}%`,
      top: `${b.y * 100}%`,
      width: `${b.w * 100}%`,
      height: `${b.h * 100}%`,
    });
    return createElement(
      "div",
      {
        key: n,
        className: "vwp-page",
        "data-page": n,
        "data-testid": `vwp-page-${n}`,
        "data-near": near ? "1" : "0",
        ref: (el: HTMLDivElement | null) => {
          if (el) frames.current.set(n, el);
          else frames.current.delete(n);
        },
        style: { top: tops[n - 1] ?? 0, width: w, height: h, marginLeft: -w / 2 },
      },
      ...marks.map((m) =>
        createElement("div", {
          key: m.id,
          className: "vwp-mark",
          "data-rxbox": "1",
          "data-mark": m.id,
          "data-testid": `vwp-rbox-${m.id}`,
          style: box(m.box),
        }),
      ),
      ...pins.map((x) =>
        createElement(
          "div",
          { key: x.id, className: "vwp-pin", "data-testid": `vwp-pin-${x.n}`, style: box(x.box), title: x.text },
          createElement("b", null, String(x.n)),
        ),
      ),
      live
        ? (() => {
            const b = unitBox(live.a, live.b);
            return b ? createElement("div", { key: "drag", className: "vwp-drag", style: box(b) }) : null;
          })()
        : null,
    );
  };
  const frameEls: ReactElement[] = [];
  for (let n = 1; n <= doc.numPages; n++) frameEls.push(frame(n));
  const [askPage, askBox] =
    asking === null
      ? [0, null]
      : [
          Number(asking.split(":")[0]),
          JSON.parse(asking.slice(asking.indexOf(":") + 1)) as { x: number; y: number; w: number; h: number },
        ];
  return createElement(
    "div",
    {
      className: `vwp${p.tool !== null ? " vwp-tool" : ""}`,
      "data-testid": "vwp",
      "data-pages": doc.numPages,
      "data-scale": W(scale),
    },
    p.thumbs
      ? createElement(Thumbs, {
          doc,
          count: doc.numPages,
          ratio: base.h / base.w,
          page,
          onPick: (n: number) =>
            scroller.current && (scroller.current.scrollTop = Math.max(0, (tops[n - 1] ?? 0) - PAGE_GAP)),
        })
      : null,
    createElement(
      "div",
      {
        className: "vwp-scroll",
        ref: scroller,
        "data-testid": "vwp-scroll",
        tabIndex: 0,
        onScroll: (e: { currentTarget: HTMLElement }) =>
          setView({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight }),
        onMouseUp,
        onMouseDown: down,
        onMouseMove: move,
        onMouseUpCapture: up,
      },
      createElement(
        "div",
        {
          style: { position: "relative", height: total, minWidth: Math.max(...sizes.map((s) => s.w * scale), 0) + 32 },
        },
        ...frameEls,
      ),
      bar && p.tool === null
        ? createElement(
            "div",
            {
              className: "vwp-bar",
              style: { left: bar.x, top: bar.y + (scroller.current?.scrollTop ?? 0) },
              "data-testid": "vwp-selbar",
            },
            createElement(
              "button",
              {
                "data-testid": "vwp-sel-comment",
                onClick: () => {
                  askQuote.current = bar.quote;
                  setAsking(`${bar.page}:${JSON.stringify(bar.box)}`);
                  p.onSelect?.({ quote: bar.quote, page: bar.page, box: bar.box });
                },
              },
              "Comment",
            ),
            createElement(
              "button",
              {
                "data-testid": "vwp-sel-redact",
                onClick: () => {
                  p.onArea({ tool: "redact", page: bar.page, box: bar.box, text: bar.quote });
                  setBar(null);
                  window.getSelection()?.removeAllRanges();
                },
              },
              "Redact",
            ),
          )
        : null,
      askBox
        ? createElement(
            "div",
            {
              className: "vwp-bar",
              style: {
                left: 24,
                top:
                  (tops[askPage - 1] ?? 0) +
                  askBox.y * (heights[askPage - 1] ?? 0) +
                  askBox.h * (heights[askPage - 1] ?? 0) +
                  6,
              },
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
                  p.onArea({
                    tool: "comment",
                    page: askPage,
                    box: askBox,
                    text: e.currentTarget.value.trim(),
                    quote: askQuote.current,
                  });
                  setAsking(null);
                  setBar(null);
                  window.getSelection()?.removeAllRanges();
                }
              },
            }),
          )
        : null,
    ),
  );
}
