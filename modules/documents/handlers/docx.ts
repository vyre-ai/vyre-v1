// documents: a filled Word file read as pages of blocks (lane r42-docs), so a Space with no converter app still gets a PDF to sign. This is the plain layout: the words, headings, bold and
// italic, lists, tables and page breaks of the Word file, set in the Vyre page look (typeset.ts). Letterheads, headers, footers, pictures and exact fonts stay in the Word file; a converter
// (LibreOffice on the server) keeps all of them and is used first when the host has one. Pure functions over bytes: no file, no network.

import { createRequire } from "node:module";
import type { Block, Run } from "./vdoc.ts";

interface Zip {
  file(name: string): { asText(): string } | null;
}
const need = createRequire(import.meta.url);
let pizzip: (new (data: Uint8Array) => Zip) | null = null;

const UNESCAPE: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e.startsWith("#")) {
      const n = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // a number that is not a letter (past U+10FFFF, a surrogate, a control) is left out, never an error
      return Number.isInteger(n) && n >= 0x20 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    }
    return UNESCAPE[e.toLowerCase()] ?? "";
  });

// ---- a linear reader of the XML parts: found with indexOf, so no input (a tag opened a hundred thousand times and never closed) can make the search quadratic ----

const NAME_END = new Set([" ", ">", "/", "\n", "\t", "\r"]);
interface Span {
  /** the whole element, open tag to close tag */
  all: string;
  /** what is inside it */
  inner: string;
  /** the attributes of the open tag */
  attrs: string;
}
/** The elements <tag ...>...</tag> in order, not nested in themselves; an element that is never closed ends the search. */
function spans(xml: string, tag: string, from = 0): Span[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const out: Span[] = [];
  let at = from;
  for (;;) {
    const i = xml.indexOf(open, at);
    if (i < 0) return out;
    const next = xml[i + open.length] ?? "";
    if (!NAME_END.has(next)) {
      at = i + open.length;
      continue;
    }
    const gt = xml.indexOf(">", i);
    if (gt < 0) return out;
    if (xml[gt - 1] === "/") {
      // a self-closing element holds nothing
      out.push({ all: xml.slice(i, gt + 1), inner: "", attrs: xml.slice(i + open.length, gt - 1) });
      at = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt);
    if (end < 0) return out;
    out.push({
      all: xml.slice(i, end + close.length),
      inner: xml.slice(gt + 1, end),
      attrs: xml.slice(i + open.length, gt),
    });
    at = end + close.length;
  }
}
/** The inside of the first <tag>...</tag>, or "". */
const firstInner = (xml: string, tag: string): string => spans(xml, tag)[0]?.inner ?? "";
/** The value of an attribute w:val="..." in an attribute string. */
const valOf = (attrs: string, name = "w:val"): string | undefined => {
  const k = attrs.indexOf(`${name}="`);
  if (k < 0) return undefined;
  const e = attrs.indexOf('"', k + name.length + 2);
  return e < 0 ? undefined : attrs.slice(k + name.length + 2, e);
};
/** The first self-closing or open tag <tag .../> in a small string, as its attributes; undefined when there is none. */
function tagAttrs(xml: string, tag: string): string | undefined {
  const open = `<${tag}`;
  let at = 0;
  for (;;) {
    const i = xml.indexOf(open, at);
    if (i < 0) return undefined;
    if (!NAME_END.has(xml[i + open.length] ?? "")) {
      at = i + open.length;
      continue;
    }
    const gt = xml.indexOf(">", i);
    if (gt < 0) return undefined;
    return xml.slice(i + open.length, xml[gt - 1] === "/" ? gt - 1 : gt);
  }
}

/** An on/off property: <w:b/>, <w:b w:val="1"/> are on; w:val "0", "false" or "off" is off. */
const flag = (xml: string, tag: string): boolean => {
  const a = tagAttrs(xml, `w:${tag}`);
  if (a === undefined) return false;
  const v = valOf(a);
  return v === undefined || !/^(0|false|off|none)$/i.test(v);
};

/** The numbering formats of numbering.xml that count (1. a. i.) as against a bullet; by numId. */
function orderedNumbers(zip: Zip): Set<string> {
  const xml = zip.file("word/numbering.xml")?.asText() ?? "";
  const abstractOrdered = new Map<string, boolean>();
  for (const m of spans(xml, "w:abstractNum")) {
    const id = valOf(m.attrs, "w:abstractNumId");
    if (id === undefined) continue;
    const lvl = spans(m.inner, "w:lvl").find((l) => valOf(l.attrs, "w:ilvl") === "0");
    const first = lvl ? valOf(tagAttrs(lvl.inner, "w:numFmt") ?? "") : undefined;
    abstractOrdered.set(id, first !== undefined && first !== "bullet" && first !== "none");
  }
  const out = new Set<string>();
  for (const m of spans(xml, "w:num")) {
    const id = valOf(m.attrs, "w:numId");
    const abs = valOf(tagAttrs(m.inner, "w:abstractNumId") ?? "");
    if (id !== undefined && abs !== undefined && abstractOrdered.get(abs)) out.add(id);
  }
  return out;
}

interface Para {
  runs: Run[];
  heading?: 1 | 2 | 3;
  list?: { numId: string; depth: number };
  pageBreak: boolean;
}

function readPara(xml: string): Para {
  const props = firstInner(xml, "w:pPr");
  const style = valOf(tagAttrs(props, "w:pStyle") ?? "") ?? "";
  const h = /^(?:Heading|heading)\s?([1-9])$/.exec(style);
  const heading: 1 | 2 | 3 | undefined = h
    ? (Math.min(Number(h[1]), 3) as 1 | 2 | 3)
    : /^(Title|Subtitle)$/i.test(style)
      ? 1
      : undefined;
  const num = spans(props, "w:numPr")[0]?.inner;
  const numRaw = num ? valOf(tagAttrs(num, "w:numId") ?? "") : undefined;
  const numId = numRaw !== undefined && /^\d+$/.test(numRaw) ? numRaw : undefined;
  const ilvlRaw = num ? valOf(tagAttrs(num, "w:ilvl") ?? "") : undefined;
  const ilvl = ilvlRaw !== undefined && /^\d+$/.test(ilvlRaw) ? Number(ilvlRaw) : 0;
  const pb = tagAttrs(props, "w:pageBreakBefore");
  let pageBreak = pb !== undefined && !/^(0|false)$/.test(valOf(pb) ?? "");
  const runs: Run[] = [];
  const push = (text: string, b: boolean, i: boolean): void => {
    if (text === "") return;
    const last = runs[runs.length - 1];
    if (last && !!last.b === b && !!last.i === i) last.text += text;
    else runs.push({ text, ...(b ? { b } : {}), ...(i ? { i } : {}) });
  };
  for (const r of spans(xml, "w:r")) {
    const body = r.inner;
    const rPr = firstInner(body, "w:rPr");
    const b = flag(rPr, "b");
    const i = flag(rPr, "i");
    // text, tabs and breaks in the order they stand, read by walking the element names
    let at = 0;
    for (;;) {
      const k = body.indexOf("<w:", at);
      if (k < 0) break;
      let e = k + 3;
      while (e < body.length && !NAME_END.has(body[e] as string)) e++;
      const name = body.slice(k + 3, e);
      const gt = body.indexOf(">", e);
      if (gt < 0) break;
      const attrs = body.slice(e, body[gt - 1] === "/" ? gt - 1 : gt);
      const selfClosed = body[gt - 1] === "/";
      at = gt + 1;
      if (name === "t" && !selfClosed) {
        const end = body.indexOf("</w:t>", gt);
        if (end < 0) break;
        push(unxml(body.slice(gt + 1, end)), b, i);
        at = end + 6;
      } else if (name === "tab") push("    ", b, i);
      else if (name === "noBreakHyphen") push("-", b, i);
      else if (name === "br") {
        if (valOf(attrs, "w:type") === "page") pageBreak = true;
        else push(" ", b, i);
      }
    }
  }
  return {
    runs,
    pageBreak,
    ...(heading ? { heading } : {}),
    ...(numId !== undefined ? { list: { numId, depth: Math.min(ilvl, 3) } } : {}),
  };
}

const plain = (runs: Run[]): Run[] =>
  runs.length === 0 ? [] : runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") }));

/** The body of a .docx as blocks; a file that is not a readable Word file is an Error with a plain message. */
export function docxBlocks(bytes: Uint8Array): Block[] {
  pizzip ??= need("pizzip") as new (data: Uint8Array) => Zip;
  let zip: Zip;
  let body: string;
  try {
    zip = new pizzip(bytes);
    body = zip.file("word/document.xml")?.asText() ?? "";
  } catch {
    throw new Error("that is not a Word file");
  }
  if (body === "") throw new Error("that is not a Word file");
  const ordered = orderedNumbers(zip);
  const out: Block[] = [];
  const counters = new Map<string, number[]>();
  const paraBlock = (p: Para): void => {
    if (p.pageBreak) out.push({ t: "break" });
    const runs = plain(p.runs);
    const empty = runs.every((r) => r.text.trim() === "");
    if (empty) return;
    if (p.heading) {
      out.push({ t: "h", level: p.heading, runs });
      return;
    }
    if (p.list) {
      const isOrdered = ordered.has(p.list.numId);
      const c = counters.get(p.list.numId) ?? [];
      c[p.list.depth] = (c[p.list.depth] ?? 0) + 1;
      c.length = p.list.depth + 1;
      counters.set(p.list.numId, c);
      out.push({
        t: "li",
        ordered: isOrdered,
        marker: isOrdered ? `${c[p.list.depth]}.` : "•",
        depth: p.list.depth,
        runs,
      });
      return;
    }
    out.push({ t: "p", runs });
  };
  const text = (xml: string): Run[] =>
    plain(spans(xml, "w:p").flatMap((m) => [...readPara(m.all).runs, { text: " " }]));
  // walk the top level of the body: paragraphs and tables in order (a table is one element; paragraphs outside tables are the rest)
  const inner = firstInner(body, "w:body") || body;
  const tops: { xml: string; table: boolean }[] = [];
  {
    const tables = spans(inner, "w:tbl");
    let at = 0;
    for (const t of tables) {
      const start = inner.indexOf(t.all, at);
      for (const p of spans(inner.slice(at, start), "w:p")) tops.push({ xml: p.all, table: false });
      tops.push({ xml: t.all, table: true });
      at = start + t.all.length;
    }
    for (const p of spans(inner.slice(at), "w:p")) tops.push({ xml: p.all, table: false });
  }
  for (const m of tops) {
    const xml = m.xml;
    if (m.table) {
      const rows = spans(xml, "w:tr").map((tr) =>
        spans(tr.all, "w:tc").map((tc) => {
          const cell = text(tc.all);
          while (cell.length > 0 && cell[cell.length - 1]!.text.trim() === "") cell.pop();
          return cell;
        }),
      );
      const kept = rows.filter((r) => r.length > 0 && r.some((c) => c.some((x) => x.text.trim() !== "")));
      if (kept.length === 0) continue;
      const width = Math.max(...kept.map((r) => r.length));
      const fit = (r: Run[][]): Run[][] => Array.from({ length: width }, (_v, i) => r[i] ?? []);
      out.push({ t: "table", head: fit(kept[0]!), rows: kept.slice(1).map(fit) });
    } else paraBlock(readPara(xml));
  }
  if (out.length === 0) throw new Error("the Word file has no text to set on pages");
  return out;
}
