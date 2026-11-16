// A PowerPoint file as slides: each slide's text boxes, shapes with a plain fill, pictures and tables placed where the file puts them (the slide's own position, or its layout's for a placeholder), at the
// slide's size. Edited: the words of a text box or a table cell. Written: only the slide's own XML changes, and only for a slide whose words changed; every other part is carried over byte for byte.
// Not drawn: gradients and effects, charts, SmartArt, grouped shapes' own transform, animations and transitions, speaker notes (they stay in the file).
import { attr, el, kid, kids, parseXml, setAttr, textOf, writeXml } from "./ooxml.ts";
import type { XDoc, XNode } from "./ooxml.ts";

export interface PRun {
  node: XNode;
  text: string;
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string;
}
export interface PPara {
  node: XNode;
  runs: PRun[];
  align?: string;
  bullet?: boolean;
  /** Placeholder kind ("title", "body"), from the file. */
  text: string;
}
export interface PShape {
  id: string;
  kind: "text" | "pic" | "table";
  /** EMU. */
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  paras: PPara[];
  title: boolean;
  pic?: { path: string; alt: string };
  table?: PPara[][][];
}
export interface PSlide {
  n: number;
  path: string;
  doc: XDoc;
  shapes: PShape[];
  texts: string;
  dirty: boolean;
}
export interface PptxModel {
  entries: Record<string, Uint8Array>;
  w: number;
  h: number;
  slides: PSlide[];
  notDrawn: string[];
}

const dec = new TextDecoder();
const enc = new TextEncoder();

function rels(xml: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (xml) for (const r of kids(parseXml(xml).root, "Relationship")) out[attr(r, "Id") ?? ""] = attr(r, "Target") ?? "";
  return out;
}
const resolve = (base: string, target: string): string => {
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

function para(p: XNode): PPara {
  const runs: PRun[] = [];
  for (const r of kids(p, "a:r")) {
    const rPr = kid(r, "a:rPr");
    const clr = attr(kid(kid(rPr, "a:solidFill"), "a:srgbClr"), "val");
    runs.push({
      node: r,
      text: textOf(kid(r, "a:t") ?? el("a:t")),
      ...(attr(rPr, "sz") ? { sz: Number(attr(rPr, "sz")) / 100 } : {}),
      ...(attr(rPr, "b") === "1" ? { b: true } : {}),
      ...(attr(rPr, "i") === "1" ? { i: true } : {}),
      ...(attr(rPr, "u") && attr(rPr, "u") !== "none" ? { u: true } : {}),
      ...(clr ? { color: `#${clr}` } : {}),
    });
  }
  const pPr = kid(p, "a:pPr");
  const algn = attr(pPr, "algn");
  return {
    node: p,
    runs,
    ...(algn ? { align: algn === "ctr" ? "center" : algn === "r" ? "right" : "left" } : {}),
    ...(kid(pPr, "a:buChar") || kid(pPr, "a:buAutoNum") ? { bullet: true } : {}),
    text: runs.map((r) => r.text).join(""),
  };
}

const xfrmOf = (n: XNode | undefined): { x: number; y: number; w: number; h: number } | undefined => {
  const x = kid(kid(n, "p:spPr") ?? kid(n, "p:xfrm") ?? n, "a:xfrm") ?? kid(n, "p:xfrm");
  const off = kid(x, "a:off");
  const ext = kid(x, "a:ext");
  if (!off || !ext) return undefined;
  return {
    x: Number(attr(off, "x")),
    y: Number(attr(off, "y")),
    w: Number(attr(ext, "cx")),
    h: Number(attr(ext, "cy")),
  };
};

export function readPptx(entries: Record<string, Uint8Array>): PptxModel {
  const text = (p: string): string | undefined => (entries[p] ? dec.decode(entries[p]) : undefined);
  const pres = text("ppt/presentation.xml");
  if (pres === undefined) throw new Error("This is not a PowerPoint file.");
  const root = parseXml(pres).root;
  const sz = kid(root, "p:sldSz");
  const w = Number(attr(sz, "cx") ?? 9144000);
  const h = Number(attr(sz, "cy") ?? 5143500);
  const pr = rels(text("ppt/_rels/presentation.xml.rels"));
  const notDrawn = new Set<string>();
  const slides: PSlide[] = [];
  const ids = kids(kid(root, "p:sldIdLst") ?? root, "p:sldId");
  ids.forEach((s, i) => {
    const target = pr[attr(s, "r:id") ?? ""];
    if (!target) return;
    const path = resolve("ppt/presentation.xml", target);
    const xml = text(path);
    if (xml === undefined) return;
    const doc = parseXml(xml);
    const sr = rels(text(`${path.replace(/[^/]+$/, "_rels/")}${path.split("/").pop()}.rels`));
    // layout shapes by placeholder, for a text box that leaves its position to the layout
    const layoutPath = Object.values(sr).find((t) => /slideLayouts\//.test(t));
    const lay = layoutPath ? text(resolve(path, layoutPath)) : undefined;
    const layout = lay ? parseXml(lay).root : undefined;
    const phPos = (ph: XNode | undefined): { x: number; y: number; w: number; h: number } | undefined => {
      if (!ph || !layout) return undefined;
      const tree = kid(kid(layout, "p:cSld"), "p:spTree");
      for (const sp of kids(tree ?? layout, "p:sp")) {
        const lp = kid(kid(kid(sp, "p:nvSpPr"), "p:nvPr"), "p:ph");
        if (
          lp &&
          ((attr(ph, "idx") !== undefined && attr(lp, "idx") === attr(ph, "idx")) ||
            (attr(ph, "type") !== undefined && attr(lp, "type") === attr(ph, "type")))
        )
          return xfrmOf(sp);
      }
      return undefined;
    };
    const shapes: PShape[] = [];
    let stacked = 0;
    const visit = (parent: XNode): void => {
      for (const c of kids(parent)) {
        if (c.name === "p:grpSp") {
          notDrawn.add("grouped shapes keep their own position only");
          visit(c);
        } else if (c.name === "p:sp") {
          const ph = kid(kid(kid(c, "p:nvSpPr"), "p:nvPr"), "p:ph");
          const pos = xfrmOf(c) ??
            phPos(ph) ?? { x: 457200, y: 300000 + stacked++ * 1100000, w: w - 914400, h: 1000000 };
          const body = kid(c, "p:txBody");
          const fill = attr(kid(kid(kid(c, "p:spPr"), "a:solidFill"), "a:srgbClr"), "val");
          if (kid(kid(c, "p:spPr"), "a:gradFill")) notDrawn.add("gradients");
          const paras = kids(body ?? c, "a:p").map(para);
          shapes.push({
            id: attr(kid(kid(c, "p:nvSpPr"), "p:cNvPr"), "id") ?? String(shapes.length),
            kind: "text",
            ...pos,
            ...(fill ? { fill: `#${fill}` } : {}),
            paras,
            title: attr(ph, "type") === "title" || attr(ph, "type") === "ctrTitle",
          });
        } else if (c.name === "p:pic") {
          const rid = attr(kid(kid(c, "p:blipFill"), "a:blip"), "r:embed");
          const pos = xfrmOf(c);
          const t = rid ? sr[rid] : undefined;
          if (pos && t)
            shapes.push({
              id: attr(kid(kid(c, "p:nvPicPr"), "p:cNvPr"), "id") ?? "",
              kind: "pic",
              ...pos,
              paras: [],
              title: false,
              pic: { path: resolve(path, t), alt: attr(kid(kid(c, "p:nvPicPr"), "p:cNvPr"), "descr") ?? "" },
            });
        } else if (c.name === "p:graphicFrame") {
          const tbl = kid(kid(kid(c, "a:graphic"), "a:graphicData"), "a:tbl");
          const pos = xfrmOf(c);
          if (tbl && pos)
            shapes.push({
              id: attr(kid(kid(c, "p:nvGraphicFramePr"), "p:cNvPr"), "id") ?? "",
              kind: "table",
              ...pos,
              paras: [],
              title: false,
              table: kids(tbl, "a:tr").map((tr) =>
                kids(tr, "a:tc").map((tc) => kids(kid(tc, "a:txBody") ?? tc, "a:p").map(para)),
              ),
            });
          else notDrawn.add("charts and diagrams");
        }
      }
    };
    visit(kid(kid(doc.root, "p:cSld"), "p:spTree") ?? doc.root);
    slides.push({ n: i + 1, path, doc, shapes, texts: slideText(shapes), dirty: false });
  });
  if (Object.keys(entries).some((k) => /^ppt\/notesSlides\//.test(k))) notDrawn.add("speaker notes");
  if (Object.keys(entries).some((k) => /^ppt\/(charts|diagrams)\//.test(k))) notDrawn.add("charts and diagrams");
  return { entries, w, h, slides, notDrawn: [...notDrawn] };
}

export const paraTexts = (s: PShape): string[] =>
  s.kind === "table" ? (s.table ?? []).flat(2).map((p) => p.text) : s.paras.map((p) => p.text);
export const slideText = (shapes: readonly PShape[]): string =>
  shapes
    .flatMap(paraTexts)
    .filter((t) => t !== "")
    .join("\n");

/** The runs' new words, in order, for one paragraph. */
export function setParaRuns(s: PSlide, p: PPara, texts: readonly string[]): void {
  p.runs.forEach((r, i) => {
    const t = texts[i];
    if (t === undefined || t === r.text) return;
    r.text = t;
    let tn = kid(r.node, "a:t");
    if (!tn) {
      tn = el("a:t");
      r.node.children.push(tn);
    }
    tn.children = [t];
    delete tn.empty;
    setAttr; // (the a:t element carries no xml:space)
    s.dirty = true;
  });
  p.text = p.runs.map((r) => r.text).join("");
  s.texts = slideText(s.shapes);
}

/** The entries to write: every part as it was; each slide whose words changed as edited. */
export function writePptx(m: PptxModel): Record<string, Uint8Array> {
  const out = { ...m.entries };
  for (const s of m.slides) if (s.dirty) out[s.path] = enc.encode(writeXml(s.doc));
  return out;
}

export const deckAsText = (m: PptxModel): string => m.slides.map((s) => `# Slide ${s.n}\n${s.texts}`).join("\n\n");
