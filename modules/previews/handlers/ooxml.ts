// Word and PowerPoint files read as Markdown (rc.17, Office files in the viewer): the same words a person sees, with their shape kept, so the viewer can draw a document or a deck and an agent
// reading files.read gets structure rather than a run of lines.
//
//   docx   word/document.xml walked as XML. A paragraph's style names its heading level (styles.xml: "heading 1", Title, or an outline level), its numbering names a list (numbering.xml: a bullet or a
//          number, nested by level), bold and italic runs read as **bold** and *italic*, an outside hyperlink as [text](address), a table as a pipe table with its first row as the header, a picture
//          as [Image: its alt text]. Blocks are split by a blank line; list items and table rows follow one another. Tracked deletions, field codes and the fallback copy of a drawing are not words.
//   pptx   one slide per page, in the deck's order: "# Slide 3: Its title", then the body (a body placeholder's paragraphs as bullets, a text box's as lines, a table, a picture), then the speaker
//          notes as "Notes: ...". The footer, the date and the slide number are not words.
// The parts come through `Part` (a zip entry as text, or undefined), so nothing here reads a zip or a file.

export type Part = (name: string) => string | undefined;

export function unxml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// ---- a small XML walk -------------------------------------------------------------------------------------

interface Tok { kind: "open" | "close" | "self" | "text"; name: string; attrs: string; text: string }

/** The elements and text of an XML part, in order. Comments, processing instructions and CDATA are skipped; text is unescaped. */
function* tokens(xml: string): Generator<Tok> {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[6] !== undefined) yield { kind: "text", name: "", attrs: "", text: unxml(m[6]) };
    else if (m[1] !== undefined) yield { kind: "text", name: "", attrs: "", text: m[1] };
    else if (m[3] !== undefined) yield { kind: m[2] === "/" ? "close" : m[5] === "/" ? "self" : "open", name: m[3], attrs: m[4] ?? "", text: "" };
  }
}

const attrRe = new Map<string, RegExp>();
const attr = (attrs: string, name: string): string | undefined => {
  if (attrs === "") return undefined;
  let re = attrRe.get(name);
  if (!re) { re = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`); attrRe.set(name, re); }
  const m = re.exec(attrs);
  return m ? unxml(m[1] ?? m[2] ?? "") : undefined;
};
/** An on/off property (<w:b/>, <w:b w:val="0"/>, b="1"): absent value is on. */
const onOff = (v: string | undefined): boolean => v === undefined || !/^(0|false|off|none)$/i.test(v);

// ---- inline text ------------------------------------------------------------------------------------------

interface Run { text: string; b: boolean; i: boolean; link?: string }

/** Runs to Markdown: neighbours with the same marks are joined, and the marks sit inside the spaces ("a **bold** word", never "a** bold **word"). */
function inline(runs: readonly Run[]): string {
  const merged: Run[] = [];
  for (const r of runs) {
    if (r.text === "") continue;
    const last = merged[merged.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.link === r.link) last.text += r.text;
    else merged.push({ ...r });
  }
  let out = "";
  for (const r of merged) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
    const [lead, core, trail] = [m?.[1] ?? "", m?.[2] ?? "", m?.[3] ?? ""];
    if (core === "") { out += r.text; continue; }
    const mark = r.b && r.i ? "***" : r.b ? "**" : r.i ? "*" : "";
    // a mark cannot hold a line break: each line is marked on its own
    let body = core.split("\n").map((l) => (l.trim() === "" || mark === "" ? l : `${mark}${l}${mark}`)).join("\n");
    if (r.link !== undefined) body = `[${body}](${r.link})`;
    out += lead + body + trail;
  }
  return out;
}

const IMAGE = (alt: string): string => (alt.trim() === "" ? "[Image]" : `[Image: ${alt.trim().replace(/\s+/g, " ").replace(/[[\]]/g, "")}]`);
const cell = (s: string): string => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

/** Rows of cells as a pipe table, the first row as its header; short rows are filled. */
function pipeTable(rows: readonly (readonly string[])[]): string[] {
  const kept = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (kept.length === 0) return [];
  const width = Math.max(...kept.map((r) => r.length));
  const line = (r: readonly string[]): string => `| ${Array.from({ length: width }, (_v, i) => cell(r[i] ?? "")).join(" | ")} |`;
  return [line(kept[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...kept.slice(1).map(line)];
}

/** The external targets of a part's relationships (hyperlinks), by id. */
function linkTargets(rels: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (rels === undefined) return out;
  for (const t of tokens(rels)) {
    if (t.name !== "Relationship" || t.kind === "close") continue;
    const id = attr(t.attrs, "Id");
    const target = attr(t.attrs, "Target");
    if (id !== undefined && target !== undefined && attr(t.attrs, "TargetMode") === "External" && /^(https?:|mailto:)/i.test(target)) out.set(id, target);
  }
  return out;
}

// ---- docx -------------------------------------------------------------------------------------------------

interface Style { heading?: number; numId?: string; ilvl?: number; b?: boolean; i?: boolean; basedOn?: string }

function readStyles(xml: string | undefined): Map<string, Style> {
  const out = new Map<string, Style>();
  if (xml === undefined) return out;
  let cur: Style | null = null;
  let id = "";
  const stack: string[] = [];
  for (const t of tokens(xml)) {
    if (t.kind === "close") { stack.pop(); if (t.name === "w:style" && cur) { out.set(id, cur); cur = null; } continue; }
    if (t.kind === "text") continue;
    if (t.name === "w:style") { cur = {}; id = attr(t.attrs, "w:styleId") ?? ""; }
    else if (cur) {
      const v = attr(t.attrs, "w:val");
      const inRun = stack.includes("w:rPr") && !stack.includes("w:pPr");
      if (t.name === "w:name" && v !== undefined) {
        const h = /^heading\s*(\d)$/i.exec(v.trim());
        if (h) cur.heading = Number(h[1]);
        else if (/^title$/i.test(v.trim())) cur.heading = 1;
      } else if (t.name === "w:outlineLvl" && v !== undefined && cur.heading === undefined && Number(v) < 9) cur.heading = Number(v) + 1;
      else if (t.name === "w:basedOn" && v !== undefined) cur.basedOn = v;
      else if (t.name === "w:numId" && v !== undefined) cur.numId = v;
      else if (t.name === "w:ilvl" && v !== undefined) cur.ilvl = Number(v);
      else if (t.name === "w:b" && inRun) cur.b = onOff(v);
      else if (t.name === "w:i" && inRun) cur.i = onOff(v);
    }
    if (t.kind === "open") stack.push(t.name);
  }
  return out;
}

/** A style's value, looked up through the styles it is based on. */
function styled<K extends keyof Style>(styles: Map<string, Style>, id: string | undefined, key: K): Style[K] | undefined {
  for (let s = id, n = 0; s !== undefined && n < 12; n++) {
    const st = styles.get(s);
    if (!st) return undefined;
    if (st[key] !== undefined) return st[key];
    s = st.basedOn;
  }
  return undefined;
}

interface Level { bullet: boolean; start: number }

/** numId to its levels: whether each is a bullet and where its count starts. */
function readNumbering(xml: string | undefined): Map<string, Map<number, Level>> {
  const out = new Map<string, Map<number, Level>>();
  if (xml === undefined) return out;
  const abstract = new Map<string, Map<number, Level>>();
  const nums = new Map<string, string>();
  let absId: string | null = null;
  let lvl: number | null = null;
  let numId: string | null = null;
  for (const t of tokens(xml)) {
    if (t.kind === "text") continue;
    if (t.kind === "close") {
      if (t.name === "w:abstractNum") absId = null;
      else if (t.name === "w:lvl") lvl = null;
      else if (t.name === "w:num") numId = null;
      continue;
    }
    const v = attr(t.attrs, "w:val");
    if (t.name === "w:abstractNum") { absId = attr(t.attrs, "w:abstractNumId") ?? ""; abstract.set(absId, new Map()); }
    else if (t.name === "w:lvl" && absId !== null) { lvl = Number(attr(t.attrs, "w:ilvl") ?? "0"); abstract.get(absId)!.set(lvl, { bullet: false, start: 1 }); }
    else if (t.name === "w:numFmt" && absId !== null && lvl !== null) abstract.get(absId)!.get(lvl)!.bullet = v === "bullet" || v === "none";
    else if (t.name === "w:start" && absId !== null && lvl !== null && v !== undefined) abstract.get(absId)!.get(lvl)!.start = Number(v) || 1;
    else if (t.name === "w:num") numId = attr(t.attrs, "w:numId") ?? "";
    else if (t.name === "w:abstractNumId" && numId !== null && v !== undefined) nums.set(numId, v);
  }
  for (const [n, a] of nums) out.set(n, abstract.get(a) ?? new Map());
  return out;
}

interface Para { style?: string; numId?: string; ilvl?: number; runs: Run[] }
interface Table { rows: string[][]; row: string[] | null; cell: string[] | null }
interface Drawing { alt: string; picture: boolean }

/** A Word document as Markdown, or null when it has no document part. */
export function docxMarkdown(part: Part): string | null {
  const xml = part("word/document.xml");
  if (xml === undefined) return null;
  const styles = readStyles(part("word/styles.xml"));
  const numbering = readNumbering(part("word/numbering.xml"));
  const links = linkTargets(part("word/_rels/document.xml.rels"));
  const blocks: { text: string; tight: boolean; item: boolean }[] = [];
  const counters = new Map<string, number[]>();
  const stack: string[] = [];
  const paras: Para[] = [];
  const tables: Table[] = [];
  const drawings: Drawing[] = [];
  // a run can hold a text box, whose paragraphs have runs of their own
  const runs: Run[] = [];
  let link: string | undefined;
  let skip = 0;

  const parent = (n = 1): string | undefined => stack[stack.length - n];
  const para = (): Para | undefined => paras[paras.length - 1];
  const top = (): Run | undefined => runs[runs.length - 1];
  const push = (text: string, tight = false, item = false): void => { blocks.push({ text, tight, item }); };

  const endPara = (p: Para): void => {
    const words = inline(p.runs).replace(/[ \t]+$/gm, "");
    const table = tables[tables.length - 1];
    if (table?.cell && paras.length === 0) { if (words.trim() !== "") table.cell.push(words.trim()); return; }
    if (words.trim() === "") return;
    const heading = styled(styles, p.style, "heading");
    if (heading !== undefined) { push(`${"#".repeat(Math.min(6, Math.max(1, heading)))} ${words.replace(/\s*\n\s*/g, " ").trim()}`); return; }
    const numId = p.numId ?? styled(styles, p.style, "numId");
    if (numId !== undefined && numId !== "0") {
      const ilvl = Math.max(0, Math.min(8, p.ilvl ?? styled(styles, p.style, "ilvl") ?? 0));
      const lv = numbering.get(numId)?.get(ilvl) ?? { bullet: true, start: 1 };
      const count = counters.get(numId) ?? [];
      count[ilvl] = (count[ilvl] ?? lv.start - 1) + 1;
      count.length = ilvl + 1;
      counters.set(numId, count);
      // items of a list follow one another; the first one is a block of its own
      push(`${"  ".repeat(ilvl)}${lv.bullet ? "-" : `${count[ilvl]}.`} ${words.replace(/\n/g, " ").trim()}`, blocks[blocks.length - 1]?.item === true, true);
      return;
    }
    push(words.trim());
  };

  for (const t of tokens(xml)) {
    if (skip > 0) {
      if (t.kind === "open") skip += 1;
      else if (t.kind === "close") skip -= 1;
      continue;
    }
    if (t.kind === "text") {
      const run = top();
      if (parent() === "w:t" && run) run.text += t.text;
      continue;
    }
    const v = attr(t.attrs, "w:val");
    const run = top();
    if (t.kind === "close") {
      stack.pop();
      if (t.name === "w:r") { const r = runs.pop(); if (r) para()?.runs.push(r); }
      else if (t.name === "w:p") { const p = paras.pop(); if (p) endPara(p); }
      else if (t.name === "w:hyperlink") link = undefined;
      else if (t.name === "w:tc") { const tb = tables[tables.length - 1]; if (tb?.cell && tb.row) tb.row.push(tb.cell.join(" ")); if (tb) tb.cell = null; }
      else if (t.name === "w:tr") { const tb = tables[tables.length - 1]; if (tb?.row) tb.rows.push(tb.row); if (tb) tb.row = null; }
      else if (t.name === "w:tbl") {
        const tb = tables.pop();
        if (!tb) continue;
        const outer = tables[tables.length - 1];
        // a table in a table is read into its cell as its rows
        if (outer?.cell) outer.cell.push(tb.rows.map((r) => r.filter((c) => c !== "").join(", ")).filter((r) => r !== "").join("; "));
        else { const lines = pipeTable(tb.rows); lines.forEach((l, i) => push(l, i > 0)); }
      } else if (t.name === "w:drawing" || t.name === "w:pict") {
        const d = drawings.pop();
        const p = para();
        if (d?.picture && p) {
          // the words of the run so far come first, then the picture where it stands
          if (run && run.text !== "") { p.runs.push({ ...run }); run.text = ""; }
          p.runs.push({ text: IMAGE(d.alt), b: false, i: false });
        }
      }
      continue;
    }
    const open = t.kind === "open";
    if (t.name === "mc:Fallback" && open) { skip = 1; continue; }
    switch (t.name) {
      case "w:p": if (open) paras.push({ runs: [] }); break;
      case "w:r": if (open) runs.push({ text: "", b: false, i: false, ...(link !== undefined ? { link } : {}) }); break;
      case "w:hyperlink": { if (!open) break; const id = attr(t.attrs, "r:id"); link = id !== undefined ? links.get(id) : undefined; break; }
      case "w:tbl": if (open) tables.push({ rows: [], row: null, cell: null }); break;
      case "w:tr": { const tb = tables[tables.length - 1]; if (tb && open) tb.row = []; break; }
      case "w:tc": { const tb = tables[tables.length - 1]; if (tb && open) tb.cell = []; break; }
      case "w:pStyle": if (parent() === "w:pPr" && parent(2) === "w:p" && v !== undefined) { const p = para(); if (p) p.style = v; } break;
      case "w:numId": if (parent() === "w:numPr" && parent(3) === "w:p" && v !== undefined) { const p = para(); if (p) p.numId = v; } break;
      case "w:ilvl": if (parent() === "w:numPr" && parent(3) === "w:p" && v !== undefined) { const p = para(); if (p) p.ilvl = Number(v); } break;
      case "w:b": if (parent() === "w:rPr" && parent(2) === "w:r" && run) run.b = onOff(v); break;
      case "w:i": if (parent() === "w:rPr" && parent(2) === "w:r" && run) run.i = onOff(v); break;
      case "w:rStyle": if (parent() === "w:rPr" && parent(2) === "w:r" && run && v !== undefined) { run.b = run.b || styled(styles, v, "b") === true; run.i = run.i || styled(styles, v, "i") === true; } break;
      case "w:tab": if (parent() === "w:r" && run) run.text += "\t"; break;
      case "w:br": case "w:cr": if (parent() === "w:r" && run) run.text += "\n"; break;
      case "w:noBreakHyphen": if (parent() === "w:r" && run) run.text += "-"; break;
      case "w:drawing": case "w:pict": if (open) drawings.push({ alt: "", picture: false }); break;
      case "wp:docPr": { const d = drawings[drawings.length - 1]; if (d) d.alt = attr(t.attrs, "descr") || attr(t.attrs, "title") || ""; break; }
      case "a:blip": case "v:imagedata": {
        const d = drawings[drawings.length - 1];
        if (d) { d.picture = true; if (d.alt === "") d.alt = attr(t.attrs, "o:title") ?? ""; }
        break;
      }
      default: break;
    }
    if (open) stack.push(t.name);
  }
  let out = "";
  blocks.forEach((b, i) => { out += i === 0 ? b.text : `${b.tight ? "\n" : "\n\n"}${b.text}`; });
  return out;
}

// ---- pptx -------------------------------------------------------------------------------------------------

interface SlidePara { runs: Run[]; lvl: number; bullet: "none" | "char" | "auto" | "inherit" }
interface Shape { ph: string | null; paras: SlidePara[] }

/** What a placeholder holds: a title, words that are bulleted unless they say not, or the footer, date and slide number, which are not read. */
const phKind = (type: string | undefined): "title" | "body" | "sub" | "skip" =>
  type === "title" || type === "ctrTitle" ? "title" : type === "subTitle" ? "sub" : type === "dt" || type === "ftr" || type === "sldNum" || type === "hdr" || type === "sldImg" ? "skip" : "body";

/** One slide as Markdown: its title (or none), then each shape's words, a table or a picture, in the order the slide holds them. */
export function slideMarkdown(xml: string, n: number, notes: string): string {
  const stack: string[] = [];
  const body: string[] = [];
  let title = "";
  let shape: Shape | null = null;
  let p: SlidePara | null = null;
  let run: Run | null = null;
  let table: Table | null = null;
  let pic: { alt: string } | null = null;
  let skip = 0;
  const parent = (k = 1): string | undefined => stack[stack.length - k];

  const endShape = (s: Shape): void => {
    const kind = s.ph === null ? "text" : phKind(s.ph);
    if (kind === "skip") return;
    const lines: string[] = [];
    for (const para of s.paras) {
      const words = inline(para.runs).replace(/[ \t]+$/gm, "").trim();
      if (words === "") continue;
      const bulleted = para.bullet === "char" || para.bullet === "auto" || (para.bullet === "inherit" && kind === "body");
      lines.push(bulleted ? `${"  ".repeat(Math.min(8, para.lvl))}- ${words.replace(/\n/g, " ")}` : words);
    }
    if (lines.length === 0) return;
    if (kind === "title" && title === "") { title = lines.map((l) => l.replace(/^\s*- /, "")).join(" ").replace(/\s*\n\s*/g, " "); return; }
    body.push(lines.join("\n"));
  };

  for (const t of tokens(xml)) {
    if (skip > 0) {
      if (t.kind === "open") skip += 1;
      else if (t.kind === "close") skip -= 1;
      continue;
    }
    if (t.kind === "text") {
      if (parent() === "a:t" && run) run.text += t.text;
      continue;
    }
    if (t.kind === "close") {
      stack.pop();
      if (t.name === "a:r" || t.name === "a:fld") { if (run && p) p.runs.push(run); run = null; }
      else if (t.name === "a:p") {
        if (p) {
          if (table?.cell) { const w = inline(p.runs).trim(); if (w !== "") table.cell.push(w); }
          else shape?.paras.push(p);
        }
        p = null;
      } else if (t.name === "p:sp") { if (shape) endShape(shape); shape = null; }
      else if (t.name === "a:tc") { if (table?.cell && table.row) table.row.push(table.cell.join(" ")); if (table) table.cell = null; }
      else if (t.name === "a:tr") { if (table?.row) table.rows.push(table.row); if (table) table.row = null; }
      else if (t.name === "a:tbl") { if (table) { const lines = pipeTable(table.rows); if (lines.length > 0) body.push(lines.join("\n")); } table = null; }
      else if (t.name === "p:pic") { if (pic) body.push(IMAGE(pic.alt)); pic = null; }
      continue;
    }
    const open = t.kind === "open";
    if (t.name === "mc:Fallback" && open) { skip = 1; continue; }
    switch (t.name) {
      case "p:sp": if (open) shape = { ph: null, paras: [] }; break;
      case "p:ph": if (shape) shape.ph = attr(t.attrs, "type") ?? "obj"; break;
      case "a:p": if (open) p = { runs: [], lvl: 0, bullet: "inherit" }; break;
      case "a:pPr": if (p) p.lvl = Number(attr(t.attrs, "lvl") ?? "0") || 0; break;
      case "a:buNone": if (p) p.bullet = "none"; break;
      case "a:buChar": if (p) p.bullet = "char"; break;
      case "a:buAutoNum": if (p) p.bullet = "auto"; break;
      case "a:r": case "a:fld": if (open) run = { text: "", b: false, i: false }; break;
      case "a:rPr": if (run && (parent() === "a:r" || parent() === "a:fld")) { run.b = attr(t.attrs, "b") !== undefined && onOff(attr(t.attrs, "b")); run.i = attr(t.attrs, "i") !== undefined && onOff(attr(t.attrs, "i")); } break;
      case "a:br": if (p) p.runs.push({ text: "\n", b: false, i: false }); break;
      case "a:tbl": if (open) table = { rows: [], row: null, cell: null }; break;
      case "a:tr": if (table && open) table.row = []; break;
      case "a:tc": if (table && open) table.cell = []; break;
      case "p:pic": if (open) pic = { alt: "" }; break;
      case "p:cNvPr": if (pic && parent() === "p:nvPicPr") pic.alt = attr(t.attrs, "descr") || attr(t.attrs, "title") || ""; break;
      default: break;
    }
    if (open) stack.push(t.name);
  }
  const head = title === "" ? `# Slide ${n}` : `# Slide ${n}: ${title}`;
  return [head, ...body, ...(notes === "" ? [] : [`Notes: ${notes}`])].join("\n\n");
}
