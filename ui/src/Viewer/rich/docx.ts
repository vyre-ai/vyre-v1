// A Word file as the viewer draws and edits it. Read: paragraphs with their runs (bold, italic, underline, size, colour, font), headings, numbered and bulleted lists, tables, pictures, links, footnotes, the
// header and footer, page size and margins. Edited: the words of a run, bold, italic and underline over a selection, and a paragraph's heading level. Written: only word/document.xml changes; every other
// part of the file (styles, media, headers, numbering, settings) is carried over byte for byte. A paragraph that holds something the editor cannot change safely (tracked changes, a content control, a field)
// is read only and kept exactly as it was; it is never rewritten.
import { attr, el, isNode, kid, kids, parseXml, setAttr, textOf, writeXml } from "./ooxml.ts";
import { safeHref } from "./limits.ts";
import type { XDoc, XNode } from "./ooxml.ts";

export interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  /** Points. */
  sz?: number;
  color?: string;
  font?: string;
}
export interface DRun {
  node: XNode;
  text: string;
  props: RunProps;
  link?: string;
  image?: { rid: string; w: number; h: number; alt: string; /** the picture lives at another address: it is never fetched, the page shows a placeholder */ external?: boolean };
  pageBreak?: boolean;
  lineBreak?: boolean;
  footnote?: string;
  /** Tracked change: shown, never edited. */
  tracked?: "ins" | "del";
}
export interface DPara {
  id: string;
  node: XNode;
  runs: DRun[];
  /** Heading level 1 to 6, from the paragraph's style. */
  heading?: number;
  list?: { level: number; marker: string };
  align?: string;
  indent?: number;
  before?: number;
  after?: number;
  /** The paragraph's own text properties from its style (a heading's size and weight). */
  base: RunProps;
  text: string;
  /** Why the paragraph cannot be edited here, when it cannot. */
  why?: string;
}
export interface DCell {
  blocks: DBlock[];
  span: number;
  fill?: string;
}
export interface DTable {
  id: string;
  rows: DCell[][];
}
export type DBlock = { t: "p"; p: DPara } | { t: "tbl"; tbl: DTable };

export interface DocxModel {
  doc: XDoc;
  entries: Record<string, Uint8Array>;
  blocks: DBlock[];
  /** Every paragraph of the body in reading order (tables included): Find, comments and edits address these. */
  paras: DPara[];
  header: DPara[];
  footer: DPara[];
  footnotes: { id: string; paras: DPara[] }[];
  page: { w: number; h: number; ml: number; mr: number; mt: number; mb: number };
  /** The entries a picture is read from, by relationship id. */
  media: Record<string, string>;
  /** Hyperlink targets by relationship id. */
  links: Record<string, string>;
  /** What the file has that this view does not draw, in a few words, shown once. */
  notDrawn: string[];
  /** The heading styles the file defines, by level, for the heading control. */
  headingStyles: Record<number, string>;
  dirty: boolean;
}

const dec = new TextDecoder();
const enc = new TextEncoder();
const on = (n: XNode | undefined): boolean =>
  n !== undefined && !["0", "false", "off"].includes(attr(n, "w:val") ?? "true");

function runProps(rPr: XNode | undefined): RunProps {
  const o: RunProps = {};
  if (!rPr) return o;
  const b = kid(rPr, "w:b");
  if (b) o.b = on(b);
  const i = kid(rPr, "w:i");
  if (i) o.i = on(i);
  const u = kid(rPr, "w:u");
  if (u) o.u = (attr(u, "w:val") ?? "single") !== "none";
  const st = kid(rPr, "w:strike");
  if (st) o.strike = on(st);
  const sz = kid(rPr, "w:sz");
  if (sz) o.sz = Number(attr(sz, "w:val") ?? 0) / 2 || undefined!;
  const c = kid(rPr, "w:color");
  const cv = attr(c, "w:val");
  if (cv && cv !== "auto") o.color = `#${cv}`;
  const f = kid(rPr, "w:rFonts");
  const fv = attr(f, "w:ascii") ?? attr(f, "w:hAnsi");
  if (fv) o.font = fv;
  for (const k of Object.keys(o) as (keyof RunProps)[]) if (o[k] === undefined) delete o[k];
  return o;
}

interface Style {
  name: string;
  basedOn?: string;
  props: RunProps;
  align?: string;
  before?: number;
  after?: number;
}

function readStyles(xml: string | undefined): { styles: Map<string, Style>; defaults: RunProps } {
  const styles = new Map<string, Style>();
  let defaults: RunProps = {};
  if (xml === undefined) return { styles, defaults };
  const root = parseXml(xml).root;
  defaults = runProps(kid(kid(kid(root, "w:docDefaults"), "w:rPrDefault"), "w:rPr"));
  for (const s of kids(root, "w:style")) {
    const id = attr(s, "w:styleId");
    if (!id) continue;
    const pPr = kid(s, "w:pPr");
    const sp = kid(pPr, "w:spacing");
    styles.set(id, {
      name: (attr(kid(s, "w:name"), "w:val") ?? "").toLowerCase(),
      ...(attr(kid(s, "w:basedOn"), "w:val") ? { basedOn: attr(kid(s, "w:basedOn"), "w:val")! } : {}),
      props: runProps(kid(s, "w:rPr")),
      ...(attr(kid(pPr, "w:jc"), "w:val") ? { align: attr(kid(pPr, "w:jc"), "w:val")! } : {}),
      ...(sp && attr(sp, "w:before") ? { before: Number(attr(sp, "w:before")) / 20 } : {}),
      ...(sp && attr(sp, "w:after") ? { after: Number(attr(sp, "w:after")) / 20 } : {}),
    });
  }
  return { styles, defaults };
}

const chain = (styles: Map<string, Style>, id: string | undefined): Style[] => {
  const out: Style[] = [];
  for (let n = 0; id !== undefined && n < 8; n++) {
    const s = styles.get(id);
    if (!s) break;
    out.unshift(s);
    id = s.basedOn;
  }
  return out;
};

function readNumbering(
  xml: string | undefined,
): (numId: string, level: number) => { fmt: string; text: string } | undefined {
  if (xml === undefined) return () => undefined;
  const root = parseXml(xml).root;
  const abstracts = new Map<string, Map<number, { fmt: string; text: string }>>();
  for (const a of kids(root, "w:abstractNum")) {
    const lv = new Map<number, { fmt: string; text: string }>();
    for (const l of kids(a, "w:lvl"))
      lv.set(Number(attr(l, "w:ilvl") ?? 0), {
        fmt: attr(kid(l, "w:numFmt"), "w:val") ?? "decimal",
        text: attr(kid(l, "w:lvlText"), "w:val") ?? "",
      });
    abstracts.set(attr(a, "w:abstractNumId") ?? "", lv);
  }
  const nums = new Map<string, string>();
  for (const n of kids(root, "w:num"))
    nums.set(attr(n, "w:numId") ?? "", attr(kid(n, "w:abstractNumId"), "w:val") ?? "");
  return (numId, level) => abstracts.get(nums.get(numId) ?? "")?.get(level);
}

const roman = (n: number): string => {
  const t: [number, string][] = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let s = "";
  for (const [v, r] of t) while (n >= v) ((s += r), (n -= v));
  return s;
};
const letter = (n: number): string => String.fromCharCode(96 + (((n - 1) % 26) + 1));

function relsOf(xml: string | undefined): Record<string, { target: string; ext: boolean }> {
  const out: Record<string, { target: string; ext: boolean }> = {};
  if (xml === undefined) return out;
  for (const r of kids(parseXml(xml).root, "Relationship"))
    out[attr(r, "Id") ?? ""] = { target: attr(r, "Target") ?? "", ext: attr(r, "TargetMode") === "External" };
  return out;
}

export function readDocx(entries: Record<string, Uint8Array>): DocxModel {
  const text = (p: string): string | undefined => (entries[p] ? dec.decode(entries[p]) : undefined);
  const docXml = text("word/document.xml");
  if (docXml === undefined) throw new Error("This is not a Word file.");
  const doc = parseXml(docXml);
  const { styles, defaults } = readStyles(text("word/styles.xml"));
  const numFor = readNumbering(text("word/numbering.xml"));
  const rels = relsOf(text("word/_rels/document.xml.rels"));
  const media: Record<string, string> = {};
  const links: Record<string, string> = {};
  for (const [id, r] of Object.entries(rels)) {
    if (r.ext) links[id] = r.target;
    else if (/^media\//.test(r.target)) media[id] = `word/${r.target}`;
  }
  const headingStyles: Record<number, string> = {};
  for (const [id, s] of styles) {
    const m = /^heading (\d)$/.exec(s.name);
    if (m) headingStyles[Number(m[1])] = id;
  }
  const notDrawn = new Set<string>();
  let nextId = 0;
  const counters = new Map<string, number[]>();

  const para = (p: XNode, bucket: DPara[]): DPara => {
    const pPr = kid(p, "w:pPr");
    const styleId = attr(kid(pPr, "w:pStyle"), "w:val");
    const sc = chain(styles, styleId);
    const base: RunProps = { ...defaults };
    for (const s of sc) Object.assign(base, s.props);
    Object.assign(base, runProps(kid(kid(pPr, "w:pPr") ?? pPr, "w:rPr")));
    const heading = (() => {
      const m = /^heading (\d)$/.exec(sc[sc.length - 1]?.name ?? "") ?? /^heading(\d)$/i.exec(styleId ?? "");
      return m ? Number(m[1]) : sc.some((s) => s.name === "title") ? 1 : undefined;
    })();
    const runs: DRun[] = [];
    let why: string | undefined;
    const addRun = (r: XNode, link?: string, tracked?: "ins" | "del"): void => {
      const rp = { ...base, ...runProps(kid(r, "w:rPr")) };
      const rs = attr(kid(kid(r, "w:rPr"), "w:rStyle"), "w:val");
      for (const s of chain(styles, rs)) Object.assign(rp, s.props, runProps(kid(r, "w:rPr")));
      let t = "";
      const out: DRun = { node: r, text: "", props: rp, ...(link ? { link } : {}), ...(tracked ? { tracked } : {}) };
      for (const c of kids(r)) {
        if (c.name === "w:t" || c.name === "w:delText") t += textOf(c);
        else if (c.name === "w:tab") t += "\t";
        else if (c.name === "w:br") {
          if (attr(c, "w:type") === "page") out.pageBreak = true;
          else out.lineBreak = true;
        } else if (c.name === "w:drawing") {
          const blip = (function find(n: XNode): XNode | undefined {
            if (n.name === "a:blip") return n;
            for (const k of kids(n)) {
              const f = find(k);
              if (f) return f;
            }
            return undefined;
          })(c);
          const ext = (function find(n: XNode): XNode | undefined {
            if (n.name === "wp:extent") return n;
            for (const k of kids(n)) {
              const f = find(k);
              if (f) return f;
            }
            return undefined;
          })(c);
          const rid = attr(blip, "r:embed");
          if (rid) {
            const docPr = (function find(n: XNode): XNode | undefined {
              if (n.name === "wp:docPr") return n;
              for (const k of kids(n)) {
                const f = find(k);
                if (f) return f;
              }
              return undefined;
            })(c);
            out.image = {
              rid,
              w: Number(attr(ext, "cx") ?? 0) / 9525,
              h: Number(attr(ext, "cy") ?? 0) / 9525,
              alt: attr(docPr, "descr") ?? "",
            };
          } else if (attr(blip, "r:link")) {
            // a picture linked from another site: fetching it would tell that site the file was opened (a tracking pixel), so it is never loaded
            out.image = { rid: "", w: Number(attr(ext, "cx") ?? 0) / 9525, h: Number(attr(ext, "cy") ?? 0) / 9525, alt: "", external: true };
            notDrawn.add("pictures linked from other sites");
          } else notDrawn.add("shapes and charts");
        } else if (c.name === "w:footnoteReference") out.footnote = attr(c, "w:id") ?? "";
        else if (c.name === "w:sym" || c.name === "w:pict" || c.name === "mc:AlternateContent")
          notDrawn.add("shapes and charts");
      }
      out.text = t;
      runs.push(out);
    };
    for (const c of kids(p)) {
      if (c.name === "w:r") addRun(c);
      else if (c.name === "w:hyperlink") {
        // only web, mail and in-document addresses become links; a javascript:, data: or file: address in a file is plain text
        const link = safeHref(links[attr(c, "r:id") ?? ""] ?? (attr(c, "w:anchor") ? `#${attr(c, "w:anchor")}` : undefined));
        for (const r of kids(c, "w:r")) addRun(r, link);
      } else if (c.name === "w:ins" || c.name === "w:del") {
        why = "Tracked changes are shown here and kept as they are. Open it in Word to change them.";
        for (const r of kids(c, "w:r")) addRun(r, undefined, c.name === "w:ins" ? "ins" : "del");
      } else if (c.name === "w:sdt") {
        why = "This is a content control. Open it in Word to change it.";
        for (const r of kids(kid(c, "w:sdtContent") ?? c, "w:r")) addRun(r);
      } else if (c.name === "w:fldSimple") {
        why = "This is a field. Open it in Word to change it.";
        for (const r of kids(c, "w:r")) addRun(r);
      } else if (
        ![
          "w:pPr",
          "w:proofErr",
          "w:bookmarkStart",
          "w:bookmarkEnd",
          "w:commentRangeStart",
          "w:commentRangeEnd",
        ].includes(c.name)
      ) {
        why = "This part holds something that is not edited here.";
      }
    }
    // complex fields (w:fldChar) make the paragraph read only too
    if (runs.some((r) => kids(r.node).some((k) => k.name === "w:fldChar")))
      why ??= "This is a field. Open it in Word to change it.";
    const numPr = kid(pPr, "w:numPr");
    let list: DPara["list"];
    const numId = attr(kid(numPr, "w:numId"), "w:val");
    if (numPr && numId && numId !== "0") {
      const level = Number(attr(kid(numPr, "w:ilvl"), "w:val") ?? 0);
      const d = numFor(numId, level);
      const cs = counters.get(numId) ?? [];
      cs[level] = (cs[level] ?? 0) + 1;
      cs.length = level + 1;
      counters.set(numId, cs);
      const n = cs[level]!;
      list = {
        level,
        marker:
          d === undefined || d.fmt === "bullet" || d.text === ""
            ? "•"
            : d.text.replace(
                /%\d/,
                d.fmt === "lowerLetter"
                  ? letter(n)
                  : d.fmt === "upperLetter"
                    ? letter(n).toUpperCase()
                    : d.fmt === "lowerRoman"
                      ? roman(n)
                      : d.fmt === "upperRoman"
                        ? roman(n).toUpperCase()
                        : String(n),
              ),
      };
    }
    const sp = kid(pPr, "w:spacing");
    const ind = kid(pPr, "w:ind");
    const jc = attr(kid(pPr, "w:jc"), "w:val") ?? [...sc].reverse().find((s) => s.align)?.align;
    const full = runs.map((r) => (r.image ? "" : r.footnote !== undefined ? "" : r.text)).join("");
    const out: DPara = {
      id: `d${nextId++}`,
      node: p,
      runs,
      ...(heading ? { heading } : {}),
      ...(list ? { list } : {}),
      ...(jc ? { align: jc === "both" ? "justify" : jc } : {}),
      ...(ind && attr(ind, "w:left") ? { indent: Number(attr(ind, "w:left")) / 20 } : {}),
      ...(sp && attr(sp, "w:before") ? { before: Number(attr(sp, "w:before")) / 20 } : {}),
      ...(sp && attr(sp, "w:after") ? { after: Number(attr(sp, "w:after")) / 20 } : {}),
      base,
      text: full,
      ...(why ? { why } : {}),
    };
    bucket.push(out);
    return out;
  };

  const paras: DPara[] = [];
  const blocks = (container: XNode, bucket: DPara[]): DBlock[] => {
    const out: DBlock[] = [];
    for (const c of kids(container)) {
      if (c.name === "w:p") out.push({ t: "p", p: para(c, bucket) });
      else if (c.name === "w:tbl") {
        const rows: DCell[][] = [];
        for (const tr of kids(c, "w:tr")) {
          const cells: DCell[] = [];
          for (const tc of kids(tr, "w:tc")) {
            const tcPr = kid(tc, "w:tcPr");
            const fill = attr(kid(tcPr, "w:shd"), "w:fill");
            cells.push({
              blocks: blocks(tc, bucket),
              span: Number(attr(kid(tcPr, "w:gridSpan"), "w:val") ?? 1),
              ...(fill && fill !== "auto" ? { fill: `#${fill}` } : {}),
            });
          }
          rows.push(cells);
        }
        out.push({ t: "tbl", tbl: { id: `t${nextId++}`, rows } });
      } else if (c.name === "w:sdt") out.push(...blocks(kid(c, "w:sdtContent") ?? c, bucket));
    }
    return out;
  };
  const body = kid(doc.root, "w:body");
  if (!body) throw new Error("This is not a Word file.");
  const bl = blocks(body, paras);

  const sect = (function last(n: XNode): XNode | undefined {
    const ks = kids(n, "w:sectPr");
    return ks[ks.length - 1];
  })(body);
  const pgSz = kid(sect, "w:pgSz");
  const pgMar = kid(sect, "w:pgMar");
  const tw = (n: XNode | undefined, a: string, d: number): number => (Number(attr(n, a) ?? d) || d) / 20;
  const page = {
    w: tw(pgSz, "w:w", 12240),
    h: tw(pgSz, "w:h", 15840),
    ml: tw(pgMar, "w:left", 1440),
    mr: tw(pgMar, "w:right", 1440),
    mt: tw(pgMar, "w:top", 1440),
    mb: tw(pgMar, "w:bottom", 1440),
  };
  const refPart = (kind: "header" | "footer"): DPara[] => {
    const ref = kids(sect ?? body, `w:${kind}Reference`).find((r) => (attr(r, "w:type") ?? "default") === "default");
    const target = rels[attr(ref, "r:id") ?? ""]?.target;
    const xml = target ? text(`word/${target}`) : undefined;
    if (xml === undefined) return [];
    const bucket: DPara[] = [];
    blocks(parseXml(xml).root, bucket);
    return bucket;
  };
  const header = refPart("header");
  const footer = refPart("footer");
  const footnotes: DocxModel["footnotes"] = [];
  const fnXml = text("word/footnotes.xml");
  if (fnXml !== undefined)
    for (const f of kids(parseXml(fnXml).root, "w:footnote")) {
      const id = attr(f, "w:id") ?? "";
      if (Number(id) < 1) continue;
      const bucket: DPara[] = [];
      blocks(f, bucket);
      footnotes.push({ id, paras: bucket });
    }
  if (text("word/comments.xml") !== undefined) notDrawn.add("Word's own comments");
  if (/<w:txbxContent/.test(docXml)) notDrawn.add("text boxes");
  return {
    doc,
    entries,
    blocks: bl,
    paras,
    header,
    footer,
    footnotes,
    page,
    media,
    links,
    notDrawn: [...notDrawn],
    headingStyles,
    dirty: false,
  };
}

/** The run's text set, in the file: the first w:t takes it, the others are emptied. A run with no w:t gets one. */
export function setRunText(r: DRun, value: string): void {
  r.text = value;
  const parts = kids(r.node).filter((c) => c.name === "w:t");
  const first =
    parts[0] ??
    (() => {
      const t = el("w:t", [], []);
      r.node.children.push(t);
      return t;
    })();
  first.children = [value];
  delete first.empty;
  setAttr(first, "xml:space", "preserve");
  for (const extra of parts.slice(1)) {
    extra.children = [];
  }
}

/** The editable runs of a paragraph, in order (a picture, a break or a footnote mark has no words to type into). */
export const textRuns = (p: DPara): DRun[] =>
  p.runs.filter((r) => r.image === undefined && r.footnote === undefined && !r.pageBreak && r.tracked === undefined);

/** A paragraph's words changed by typing: each run's new text, in order. Runs not named are left as they are. */
export function applyRunTexts(model: DocxModel, p: DPara, texts: readonly string[]): void {
  if (p.why !== undefined) return;
  const runs = textRuns(p);
  runs.forEach((r, i) => {
    const t = texts[i];
    if (t !== undefined && t !== r.text) {
      setRunText(r, t);
      model.dirty = true;
    }
  });
  p.text = p.runs.map((r) => (r.image || r.footnote !== undefined ? "" : r.text)).join("");
}

const rPrOf = (r: XNode): XNode => {
  let rPr = kid(r, "w:rPr");
  if (!rPr) {
    rPr = el("w:rPr");
    r.children.unshift(rPr);
  }
  return rPr;
};

/** Splits the run holding `offset` characters into two runs (same properties); returns the index of the second. */
function splitAt(p: DPara, offset: number): number {
  let at = 0;
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i]!;
    const len = r.image || r.footnote !== undefined ? 0 : r.text.length;
    if (offset === at) return i;
    if (offset > at && offset < at + len && r.tracked === undefined) {
      const k = offset - at;
      const clone: XNode = JSON.parse(JSON.stringify(r.node));
      const second: DRun = { ...r, node: clone, text: r.text.slice(k), props: { ...r.props } };
      setRunText(r, r.text.slice(0, k));
      setRunText(second, r.text.length >= 0 ? second.text : "");
      const parent = parentOf(p.node, r.node);
      if (parent) parent.children.splice(parent.children.indexOf(r.node) + 1, 0, clone);
      p.runs.splice(i + 1, 0, second);
      return i + 1;
    }
    at += len;
  }
  return p.runs.length;
}
const parentOf = (root: XNode, target: XNode): XNode | undefined => {
  for (const c of kids(root)) {
    if (c === target) return root;
    const f = parentOf(c, target);
    if (f) return f;
  }
  return undefined;
};

/** Bold, italic or underline over characters [from, to) of a paragraph: on when any of it is off, else off. */
export function toggleFormat(model: DocxModel, p: DPara, from: number, to: number, f: "b" | "i" | "u"): void {
  if (p.why !== undefined || from >= to) return;
  const s = splitAt(p, from);
  const e = splitAt(p, to);
  const inside = p.runs.slice(s, e).filter((r) => r.image === undefined && r.footnote === undefined && r.text !== "");
  if (inside.length === 0) return;
  const allOn = inside.every((r) => r.props[f] === true);
  for (const r of inside) {
    const rPr = rPrOf(r.node);
    const tag = `w:${f}`;
    let n = kid(rPr, tag);
    if (!n) {
      n = el(tag);
      rPr.children.push(n);
    }
    if (allOn) {
      if (f === "u") setAttr(n, "w:val", "none");
      else setAttr(n, "w:val", "0");
      r.props[f] = false;
    } else {
      if (f === "u") setAttr(n, "w:val", "single");
      else n.attrs = n.attrs.filter(([k]) => k !== "w:val");
      r.props[f] = true;
    }
  }
  model.dirty = true;
}

/** A paragraph's heading level (0 for body text), using the heading styles the file defines. Returns false when the file has no style for it. */
export function setHeading(model: DocxModel, p: DPara, level: number): boolean {
  if (p.why !== undefined) return false;
  const id = level === 0 ? undefined : model.headingStyles[level];
  if (level !== 0 && id === undefined) return false;
  let pPr = kid(p.node, "w:pPr");
  if (!pPr) {
    pPr = el("w:pPr");
    p.node.children.unshift(pPr);
  }
  const cur = kid(pPr, "w:pStyle");
  if (id === undefined) {
    if (cur) pPr.children = pPr.children.filter((c) => c !== cur);
    delete p.heading;
  } else {
    if (cur) setAttr(cur, "w:val", id);
    else pPr.children.unshift(el("w:pStyle", [["w:val", id]]));
    p.heading = level;
  }
  model.dirty = true;
  return true;
}

/** The entries to write: every part as it was, document.xml as edited. */
export function writeDocx(model: DocxModel): Record<string, Uint8Array> {
  return { ...model.entries, "word/document.xml": enc.encode(writeXml(model.doc)) };
}

/** What Find, comments and the agent read: one line per paragraph, with its heading marked. */
export const paraTexts = (m: DocxModel): string[] => m.paras.map((p) => p.text);
export const docAsText = (m: DocxModel): string =>
  m.paras.map((p) => (p.heading ? `${"#".repeat(p.heading)} ${p.text}` : p.list ? `- ${p.text}` : p.text)).join("\n");
export { isNode };
