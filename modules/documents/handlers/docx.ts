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

/** An on/off property: <w:b/>, <w:b w:val="1"/> are on; w:val "0", "false" or "off" is off. */
const flag = (xml: string, tag: string): boolean => {
  const m = new RegExp(`<w:${tag}(?:\\s([^>]*?))?/?>`).exec(xml);
  if (!m) return false;
  const v = /w:val="([^"]*)"/.exec(m[1] ?? "")?.[1];
  return v === undefined || !/^(0|false|off|none)$/i.test(v);
};

/** The numbering formats of numbering.xml that count (1. a. i.) as against a bullet; by numId. */
function orderedNumbers(zip: Zip): Set<string> {
  const xml = zip.file("word/numbering.xml")?.asText() ?? "";
  const abstractOrdered = new Map<string, boolean>();
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const first = /<w:lvl\b[^>]*w:ilvl="0"[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(m[2] as string)?.[1];
    abstractOrdered.set(m[1] as string, first !== undefined && first !== "bullet" && first !== "none");
  }
  const out = new Set<string>();
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abs = /<w:abstractNumId w:val="(\d+)"/.exec(m[2] as string)?.[1];
    if (abs !== undefined && abstractOrdered.get(abs)) out.add(m[1] as string);
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
  const props = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? "";
  const style = /<w:pStyle w:val="([^"]*)"/.exec(props)?.[1] ?? "";
  const h = /^(?:Heading|heading)\s?([1-9])$/.exec(style);
  const heading: 1 | 2 | 3 | undefined = h
    ? (Math.min(Number(h[1]), 3) as 1 | 2 | 3)
    : /^(Title|Subtitle)$/i.test(style)
      ? 1
      : undefined;
  const num = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(props)?.[1];
  const numId = num ? /<w:numId w:val="(\d+)"/.exec(num)?.[1] : undefined;
  const ilvl = num ? Number(/<w:ilvl w:val="(\d+)"/.exec(num)?.[1] ?? "0") : 0;
  let pageBreak = /<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false)")/.test(props);
  const runs: Run[] = [];
  const push = (text: string, b: boolean, i: boolean): void => {
    if (text === "") return;
    const last = runs[runs.length - 1];
    if (last && !!last.b === b && !!last.i === i) last.text += text;
    else runs.push({ text, ...(b ? { b } : {}), ...(i ? { i } : {}) });
  };
  for (const r of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const body = r[1] as string;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
    const b = flag(rPr, "b");
    const i = flag(rPr, "i");
    // text, tabs and breaks in the order they stand
    for (const t of body.matchAll(
      /<w:t(?:\s[^>]*)?(?<!\/)>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b([^>]*)\/?>|<w:noBreakHyphen\s*\/>/g,
    )) {
      if (t[1] !== undefined) push(unxml(t[1]), b, i);
      else if (t[0].startsWith("<w:tab")) push("    ", b, i);
      else if (t[0].startsWith("<w:noBreak")) push("-", b, i);
      else if (/w:type="page"/.test(t[2] ?? "")) pageBreak = true;
      else push(" ", b, i);
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
    plain(Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).flatMap((m) => [...readPara(m[0]).runs, { text: " " }]));
  // walk the top level of the body: paragraphs and tables in order
  const inner = /<w:body>([\s\S]*)<\/w:body>/.exec(body)?.[1] ?? body;
  const top = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g;
  for (const m of inner.matchAll(top)) {
    const xml = m[0];
    if (xml.startsWith("<w:tbl>")) {
      const rows = Array.from(xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)).map((tr) =>
        Array.from(tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)).map((tc) => {
          const cell = text(tc[0]);
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
