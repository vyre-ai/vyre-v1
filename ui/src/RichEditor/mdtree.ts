// Markdown to the editor's document and back, for the one Markdown editor (MarkdownEditor). Pure functions, no DOM: the same code runs in the editor, in tests and in the WebView.
// The document is TipTap JSON (paragraph, heading, bulletList, orderedList, taskList, blockquote, codeBlock, horizontalRule, hardBreak, and the marks bold, italic, strike, code, link).
// What is saved is plain .md that agents read, so the round trip is built to leave a file alone: a block keeps whether a blank line came before it (`tight`), a list keeps its marker and
// whether its items were spaced, text is escaped only where it would otherwise read as markup, and anything the editor has no block for (a table, HTML, front matter, a link
// reference) is kept as a raw block, byte for byte. A file written the way this serializer writes it comes back identical.

export interface PMMark { type: string; attrs?: Record<string, unknown> }
export interface PMNode { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; marks?: PMMark[]; text?: string }

const doc = (content: PMNode[]): PMNode => ({ type: "doc", content });

/* ---------- inline ---------- */

type MarkType = "bold" | "italic" | "strike" | "link";
interface Span { text: string; marks: PMMark[] }
type Piece = Span | "br";

const MARK_ORDER: readonly string[] = ["link", "bold", "italic", "strike"];
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}_]/u;

function mark(type: MarkType, href?: string, title?: string): PMMark {
  return type === "link" ? { type, attrs: { href: href ?? "", ...(title === undefined ? {} : { title }) } } : { type };
}

/** Inline markdown to pieces: text with marks, and line breaks. */
function scan(src: string, marks: readonly PMMark[], out: Piece[], before: string): void {
  let buf = "";
  let i = 0;
  const prev = (): string => (buf !== "" ? buf.charAt(buf.length - 1) : i === 0 ? before : src.charAt(i - 1));
  const flush = (): void => { if (buf !== "") out.push({ text: buf, marks: [...marks] }); buf = ""; };
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = rest.charAt(0);
    if (ch === "\n") { flush(); out.push("br"); i += 1; continue; }
    if (ch === "\\" && rest.length > 1 && ESCAPABLE.test(rest.charAt(1))) { buf += rest.charAt(1); i += 2; continue; }
    let m: RegExpExecArray | null = null;
    if (ch === "`" && (m = /^(`+)(?!`)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush();
      const body = (m[2] ?? "").replace(/^ (.*[^ ].*) $/s, "$1");
      out.push({ text: body, marks: [...marks, { type: "code" }] });
      i += m[0].length;
      continue;
    }
    const pv = prev();
    if ((ch === "*" || ch === "_") && rest.charAt(1) === ch && (m = (ch === "*" ? /^\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)/ : /^__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\p{N}_])/u).exec(rest)) && (ch === "*" || !WORD.test(pv))) {
      flush(); scan(m[1] ?? "", [...marks, mark("bold")], out, ""); i += m[0].length; continue;
    }
    if (ch === "~" && (m = /^~~(?=\S)([\s\S]+?)(?<=\S)~~(?!~)/.exec(rest))) {
      flush(); scan(m[1] ?? "", [...marks, mark("strike")], out, ""); i += m[0].length; continue;
    }
    if (ch === "*" && rest.charAt(1) !== "*" && (m = /^\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/.exec(rest))) {
      flush(); scan(m[1] ?? "", [...marks, mark("italic")], out, ""); i += m[0].length; continue;
    }
    if (ch === "_" && rest.charAt(1) !== "_" && !WORD.test(pv) && (m = /^_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/u.exec(rest))) {
      flush(); scan(m[1] ?? "", [...marks, mark("italic")], out, ""); i += m[0].length; continue;
    }
    if (ch === "!" && (m = /^!\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)/.exec(rest))) { buf += m[0]; i += m[0].length; continue; }
    if (ch === "[" && (m = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(rest))) {
      flush(); scan(m[1] ?? "", [...marks.filter((x) => x.type !== "link"), mark("link", m[2] ?? "", m[3])], out, ""); i += m[0].length; continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
}

function sameMarks(a: readonly PMMark[], b: readonly PMMark[]): boolean {
  return a.length === b.length && a.every((x) => b.some((y) => y.type === x.type && JSON.stringify(y.attrs ?? {}) === JSON.stringify(x.attrs ?? {})));
}

/** Inline markdown to document nodes (text with marks, hard breaks). Neighbours with the same marks join. */
export function inlineToNodes(src: string): PMNode[] {
  const pieces: Piece[] = [];
  scan(src, [], pieces, "");
  const out: PMNode[] = [];
  for (const p of pieces) {
    if (p === "br") { out.push({ type: "hardBreak" }); continue; }
    if (p.text === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.type === "text" && sameMarks(last.marks ?? [], p.marks)) last.text = (last.text ?? "") + p.text;
    else out.push({ type: "text", text: p.text, ...(p.marks.length > 0 ? { marks: p.marks } : {}) });
  }
  return out;
}

/** The plain text of inline nodes. */
export function nodesText(nodes: readonly PMNode[] | undefined): string {
  let s = "";
  for (const n of nodes ?? []) s += n.type === "hardBreak" ? "\n" : n.text ?? "";
  return s;
}

/** Text that would not read as itself when parsed gets backslashes before its markup characters; everything else is written as typed. */
function escapeText(text: string): string {
  const back = (): string => nodesText(inlineToNodes(text));
  const plain = ((): boolean => { const n = inlineToNodes(text); return n.length <= 1 && n.every((x) => x.type === "text" && x.marks === undefined) && back() === text; })();
  if (plain) return text;
  return text.replace(/([\\`*_~[\]])/g, "\\$1");
}

const BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```|\s{0,3}([-*_])(?:\s*\2){2,}\s*$)/;

function markOpen(m: PMMark): string {
  switch (m.type) {
    case "bold": return "**";
    case "italic": return "*";
    case "strike": return "~~";
    case "link": return "[";
    default: return "";
  }
}
function markClose(m: PMMark): string {
  switch (m.type) {
    case "bold": return "**";
    case "italic": return "*";
    case "strike": return "~~";
    case "link": return `](${String(m.attrs?.["href"] ?? "")}${typeof m.attrs?.["title"] === "string" ? ` "${String(m.attrs["title"])}"` : ""})`;
    default: return "";
  }
}

/** Document inline nodes to markdown. Marks open and close in a fixed order and keep spaces outside; a line that would read as a block start is escaped. */
export function nodesToInline(nodes: readonly PMNode[] | undefined): string {
  let out = "";
  const open: PMMark[] = [];
  let lineStart = true;
  let pend = "";
  const closeTo = (keep: number): void => { while (open.length > keep) out += markClose(open.pop() as PMMark); };
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { closeTo(0); pend = ""; out += "\n"; lineStart = true; continue; }
    if (n.type !== "text" || n.text === undefined) continue;
    const ms = (n.marks ?? []).filter((m) => m.type !== "code").sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const isCode = (n.marks ?? []).some((m) => m.type === "code");
    const lead = /^\s*/.exec(n.text)?.[0] ?? "";
    const trail = /\s*$/.exec(n.text.slice(lead.length))?.[0] ?? "";
    const core = n.text.slice(lead.length, n.text.length - trail.length);
    if (core === "") { pend += n.text; continue; }
    let keep = 0;
    while (keep < open.length && keep < ms.length && sameMarks([open[keep] as PMMark], [ms[keep] as PMMark])) keep += 1;
    closeTo(keep);
    out += pend + lead;
    pend = "";
    for (let k = keep; k < ms.length; k += 1) { out += markOpen(ms[k] as PMMark); open.push(ms[k] as PMMark); }
    if (isCode) {
      const fence = "`".repeat((core.match(/`+/g) ?? []).reduce((a, b) => Math.max(a, b.length), 0) + 1);
      out += core.startsWith("`") || core.endsWith("`") ? `${fence} ${core} ${fence}` : `${fence}${core}${fence}`;
    } else {
      let t = escapeText(core);
      if (lineStart && out.replace(/^[\s\S]*\n/, "") === "" && BLOCK_START.test(t)) t = `\\${t}`;
      out += t;
    }
    lineStart = false;
    pend = trail;
  }
  closeTo(0);
  return out;
}

/* ---------- blocks: markdown to document ---------- */

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*(?:\s#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s{0,3})([-*+])\s+(.*)$/;
const ORDERED = /^(\s{0,3})(\d{1,9})([.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HTML_START = /^\s{0,3}<(\/?[A-Za-z][\w-]*[\s>/]|\/?[A-Za-z][\w-]*$|!--|\?)/;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s+\S+/;
const INDENTED = /^( {4}|\t)\S/;

const isBlank = (l: string | undefined): boolean => (l ?? "").trim() === "";

function startsBlock(line: string, next: string | undefined): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || BULLET.test(line) || QUOTE.test(line) || HTML_START.test(line)) return true;
  const o = ORDERED.exec(line);
  if (o && o[2] === "1") return true;
  return line.includes("|") && next !== undefined && TABLE_SEP.test(next);
}

function raw(kind: string, text: string, tight: boolean): PMNode {
  return { type: "rawBlock", attrs: { kind, tight }, content: text === "" ? [] : [{ type: "text", text }] };
}

/** Lines of one list item body, dedented by the item's content column. Returns the lines and where the item ends. */
function itemBody(lines: readonly string[], at: number, width: number): { body: string[]; end: number; spaced: boolean } {
  const body: string[] = [];
  let i = at;
  let spaced = false;
  while (i < lines.length) {
    const l = lines[i] ?? "";
    if (isBlank(l)) {
      // a blank line belongs to the item only when an indented line follows
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      if (j < lines.length && (lines[j] ?? "").search(/\S/) >= width) { for (let k = i; k < j; k += 1) body.push(""); spaced = true; i = j; continue; }
      break;
    }
    if ((l.search(/\S/)) >= width) { body.push(l.slice(width)); i += 1; continue; }
    // lazy continuation of a paragraph line
    const last = body[body.length - 1];
    if (last !== undefined && !isBlank(last) && !startsBlock(l, lines[i + 1]) && !/^\s{0,3}(\d{1,9}[.)])\s/.test(l)) { body.push(l.trim()); i += 1; continue; }
    break;
  }
  return { body, end: i, spaced };
}

function parseList(lines: readonly string[], start: number, tight: boolean): { node: PMNode[]; end: number } {
  const first = lines[start] ?? "";
  const b0 = BULLET.exec(first);
  const o0 = ORDERED.exec(first);
  const ordered = b0 === null && o0 !== null;
  const marker = ordered ? (o0?.[3] ?? ".") : (b0?.[2] ?? "-");
  const startNum = ordered ? Number(o0?.[2] ?? 1) : 1;
  const items: { task: boolean | null; checked: boolean; content: PMNode[]; gap: boolean }[] = [];
  let i = start;
  let gapNext = false;
  while (i < lines.length) {
    const l = lines[i] ?? "";
    const m = ordered ? ORDERED.exec(l) : BULLET.exec(l);
    if (!m || (ordered ? m[3] !== marker : m[2] !== marker)) break;
    const lead = m[1] ?? "";
    const text = ordered ? (m[4] ?? "") : (m[3] ?? "");
    const markLen = ordered ? `${m[2]}${m[3]}`.length : 1;
    // the content column: marker, then the spaces after it (1 to 4)
    const gap = Math.min(4, Math.max(1, l.slice(lead.length + markLen).search(/\S/)));
    const width = lead.length + markLen + gap;
    const { body, end } = itemBody(lines, i + 1, width);
    const t = TASK.exec(text);
    const firstText = t ? (t[2] ?? "") : text;
    const inner = parseBlocks([firstText, ...body], 0);
    // the item starts with a paragraph: a line the item opens with that is not one becomes an empty paragraph's neighbour
    if (inner.length === 0 || inner[0]?.type !== "paragraph") inner.unshift({ type: "paragraph" });
    items.push({ task: t ? true : null, checked: t ? t[1] !== " " : false, content: inner, gap: gapNext });
    gapNext = false;
    i = end;
    // a blank line between two items spaces the list
    if (i < lines.length && isBlank(lines[i])) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const nm = ordered ? ORDERED.exec(lines[j] ?? "") : BULLET.exec(lines[j] ?? "");
      if (j < lines.length && nm && (ordered ? nm[3] === marker : nm[2] === marker) && (nm[1] ?? "").length === lead.length) { gapNext = true; i = j; continue; }
      break;
    }
  }
  // task items and plain items are different lists; a run of one kind is one list
  const nodes: PMNode[] = [];
  let runKind: boolean | null | undefined;
  let run: PMNode[] = [];
  const emit = (): void => {
    if (run.length === 0) return;
    const task = runKind === true;
    nodes.push({
      type: task ? "taskList" : ordered ? "orderedList" : "bulletList",
      attrs: { tight: nodes.length === 0 ? tight : true, ...(ordered ? { start: startNum, delim: marker } : { marker }) },
      content: run,
    });
    run = [];
  };
  for (const it of items) {
    if (runKind !== undefined && (it.task === true) !== (runKind === true)) emit();
    runKind = it.task === true ? true : null;
    run.push(it.task === true ? { type: "taskItem", attrs: { checked: it.checked, gap: it.gap }, content: it.content } : { type: "listItem", attrs: { gap: it.gap }, content: it.content });
  }
  emit();
  return { node: nodes, end: i };
}

/** Markdown lines to blocks. */
function parseBlocks(lines: readonly string[], depth: number): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  let blank = false;
  const tightNow = (): boolean => !blank && out.length > 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) { blank = true; i += 1; continue; }
    const tight = tightNow();
    blank = false;
    const fence = FENCE.exec(line);
    if (fence) {
      const ind = (fence[1] ?? "").length;
      const closer = new RegExp(`^\\s{0,3}${(fence[2] ?? "```").charAt(0) === "`" ? "`" : "~"}{${(fence[2] ?? "```").length},}\\s*$`);
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) { if (closer.test(lines[i] ?? "")) { closed = true; break; } body.push((lines[i] ?? "").replace(new RegExp(`^ {0,${ind}}`), "")); i += 1; }
      i += closed ? 1 : 0;
      out.push({ type: "codeBlock", attrs: { language: fence[3] ?? "", tight, fence: fence[2] ?? "```" }, content: body.length === 0 ? [] : [{ type: "text", text: body.join("\n") }] });
      continue;
    }
    if (depth === 0 && out.length === 0 && line.trim() === "---" && /^---\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j] ?? "")) j += 1;
      if (j < lines.length) { out.push(raw("front", lines.slice(i, j + 1).join("\n"), false)); i = j + 1; continue; }
    }
    const heading = HEADING.exec(line);
    if (heading && !RULE.test(line)) {
      out.push({ type: "heading", attrs: { level: (heading[1] ?? "#").length, tight }, content: inlineToNodes(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (RULE.test(line)) { out.push({ type: "horizontalRule", attrs: { tight, mark: line.trim() } }); i += 1; continue; }
    if (HTML_START.test(line)) {
      const body: string[] = [];
      const comment = /^\s{0,3}<!--/.test(line);
      while (i < lines.length && (comment ? true : !isBlank(lines[i]))) { body.push(lines[i] ?? ""); i += 1; if (comment && /-->/.test(body[body.length - 1] ?? "")) break; }
      out.push(raw("html", body.join("\n"), tight));
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "") && !isBlank(lines[i + 1])) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) { body.push(lines[i] ?? ""); i += 1; }
      out.push(raw("table", body.join("\n"), tight));
      continue;
    }
    if (REF_DEF.test(line)) {
      const body: string[] = [];
      while (i < lines.length && REF_DEF.test(lines[i] ?? "")) { body.push(lines[i] ?? ""); i += 1; }
      out.push(raw("ref", body.join("\n"), tight));
      continue;
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const r = parseList(lines, i, tight);
      out.push(...r.node);
      i = r.end;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) { body.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? ""); i += 1; }
      // a quote holds blocks; one plain paragraph is the common case
      const inner = parseBlocks(body, depth + 1);
      out.push({ type: "blockquote", attrs: { tight }, content: inner.length > 0 ? inner : [{ type: "paragraph" }] });
      continue;
    }
    if (INDENTED.test(line) && out[out.length - 1]?.type !== "paragraph") {
      const body: string[] = [];
      while (i < lines.length) {
        if (INDENTED.test(lines[i] ?? "")) { body.push(lines[i] ?? ""); i += 1; continue; }
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j += 1;
        if (j > i && j < lines.length && INDENTED.test(lines[j] ?? "")) { for (let k = i; k < j; k += 1) body.push(lines[k] ?? ""); i = j; continue; }
        break;
      }
      out.push(raw("indented", body.join("\n"), tight));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i] ?? "", lines[i + 1]))) { para.push((lines[i] ?? "").replace(/^\s+/, "").replace(/(\s{2,}|\\)$/, (m) => (m === "\\" ? "\\" : "")).replace(/\s+$/, "")); i += 1; }
    out.push({ type: "paragraph", attrs: { tight }, content: inlineToNodes(para.join("\n")) });
  }
  return out;
}

/** A whole markdown text to the editor's document. */
export function markdownToDoc(md: string): PMNode {
  const text = md.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const blocks = parseBlocks(lines, 0);
  const d = doc(blocks.length > 0 ? blocks : [{ type: "paragraph" }]);
  return d;
}

/* ---------- blocks: document to markdown ---------- */

function listMarker(list: PMNode, n: number): string {
  if (list.type === "orderedList") return `${Number(list.attrs?.["start"] ?? 1) + n}${String(list.attrs?.["delim"] ?? ".")} `;
  return `${String(list.attrs?.["marker"] ?? "-")} `;
}

function indentLines(text: string, pad: string, first: string): string {
  return text.split("\n").map((l, i) => (i === 0 ? first + l : l === "" ? "" : pad + l)).join("\n");
}

function blockText(b: PMNode): string {
  switch (b.type) {
    case "paragraph": return nodesToInline(b.content);
    case "heading": return `${"#".repeat(Math.min(6, Math.max(1, Number(b.attrs?.["level"] ?? 1))))} ${nodesToInline(b.content)}`.replace(/\s+$/, "");
    case "horizontalRule": return String(b.attrs?.["mark"] ?? "---");
    case "rawBlock": return nodesText(b.content);
    case "codeBlock": {
      const body = nodesText(b.content);
      const longest = (body.match(/`{3,}/g) ?? []).reduce((a, x) => Math.max(a, x.length), 2);
      const fence = String(b.attrs?.["fence"] ?? "```");
      const f = fence.startsWith("~") ? fence : "`".repeat(Math.max(fence.length, longest + 1));
      return `${f}${String(b.attrs?.["language"] ?? "")}\n${body}${body === "" ? "" : "\n"}${f}`;
    }
    case "blockquote": return blocksToMarkdownBody(b.content ?? []).split("\n").map((l) => (l === "" ? ">" : `> ${l}`)).join("\n");
    case "bulletList": case "orderedList": case "taskList": {
      let text = "";
      for (const [n, it] of (b.content ?? []).entries()) {
        const mk = it.type === "taskItem" ? `${String(b.attrs?.["marker"] ?? "-")} [${it.attrs?.["checked"] === true ? "x" : " "}] ` : listMarker(b, n);
        const inner = blocksToMarkdownBody(it.content ?? []);
        if (n > 0) text += it.attrs?.["gap"] === true ? "\n\n" : "\n";
        text += indentLines(inner, " ".repeat(mk.length), mk);
      }
      return text;
    }
    default: return "";
  }
}

function blocksToMarkdownBody(blocks: readonly PMNode[]): string {
  let out = "";
  for (const [i, b] of blocks.entries()) {
    if (i > 0) out += b.attrs?.["tight"] === true ? "\n" : "\n\n";
    out += blockText(b);
  }
  return out;
}

/** The editor's document back to markdown. The file ends in one newline. */
export function docToMarkdown(d: PMNode): string {
  const blocks = d.content ?? [];
  if (blocks.length === 1 && blocks[0]?.type === "paragraph" && (blocks[0].content ?? []).length === 0) return "";
  const body = blocksToMarkdownBody(blocks);
  return body === "" ? "" : `${body}\n`;
}

/** Plain text of the document, for a word count or a search index. */
export function docText(d: PMNode): string {
  const out: string[] = [];
  const walk = (n: PMNode): void => {
    if (n.type === "text") { out.push(n.text ?? ""); return; }
    if (n.type === "hardBreak") { out.push("\n"); return; }
    for (const c of n.content ?? []) walk(c);
    if (["paragraph", "heading", "codeBlock", "rawBlock", "listItem", "taskItem", "blockquote"].includes(n.type)) out.push("\n");
  };
  walk(d);
  return out.join("");
}

/* ---------- paste ---------- */

/** What a paste becomes: the text without the indent it was copied with, and how much that was. A tab counts as two spaces. */
export function dedentPaste(text: string): { text: string; removed: number } {
  const t = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  const lines = t.split("\n");
  let min = Number.POSITIVE_INFINITY;
  for (const l of lines) if (l.trim() !== "") min = Math.min(min, /^ */.exec(l)?.[0].length ?? 0);
  if (!Number.isFinite(min) || min === 0) return { text: t, removed: 0 };
  return { text: lines.map((l) => l.slice(Math.min(min, /^ */.exec(l)?.[0].length ?? 0))).join("\n"), removed: min };
}

/** True when pasted text carries markdown structure worth turning into blocks (a heading, a list, a quote, a fence, several lines). */
export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  return /\n/.test(t) || /^(#{1,6} |[-*+] |\d+[.)] |> |```)/.test(t);
}

/** The line (1-based) a block of the document starts on in the markdown it writes; used to jump from a check to the line. */
export function blockOfLine(d: PMNode, line: number): number {
  let at = 1;
  const blocks = d.content ?? [];
  for (const [i, b] of blocks.entries()) {
    const text = blockText(b);
    const lines = text.split("\n").length;
    const gap = i === 0 ? 0 : b.attrs?.["tight"] === true ? 0 : 1;
    const startLine = at + gap;
    if (line < startLine + lines) return i;
    at = startLine + lines;
  }
  return Math.max(0, blocks.length - 1);
}
