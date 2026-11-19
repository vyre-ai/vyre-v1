// Markdown to the editor's document and back, for the one Markdown editor (MarkdownEditor). Pure functions, no DOM: the same code runs in the editor, in tests and in the WebView.
// The document is TipTap JSON (paragraph, heading, bulletList, orderedList, taskList, blockquote, codeBlock, horizontalRule, hardBreak, and the marks bold, italic, strike, code, link).
// What is saved is plain .md that agents read, so the round trip is built to leave a file alone: a block keeps whether a blank line came before it (`tight`), a list keeps its marker and
// whether its items were spaced, text is escaped only where it would otherwise read as markup, and anything the editor has no block for (a table, HTML, front matter, a link
// reference) is kept as a raw block, byte for byte. A file written the way this serializer writes it comes back identical.

import { criticAt } from "./doc/critic.ts";

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

const doc = (content: PMNode[]): PMNode => ({ type: "doc", content });

/**
 * A Vyre document page reads two more things out of its Markdown: a field chip (`{client.name}`, `{sign:client}`: the blanks of the fill engine) and a tracked change (CriticMarkup:
 * `{++added++}`, `{--removed--}`, `{~~old~>new~~}`, each followed by `{>>author|time<<}`). Any other Markdown file keeps both as the plain text they are, so only a page that asks for it
 * (`{ doc: true }`) sees chips and suggestions. What is written back is the same text that was read, byte for byte.
 */
export interface MdOptions {
  doc?: boolean;
}
let DOC = false;
function withDoc<T>(opt: MdOptions | undefined, run: () => T): T {
  if (opt === undefined) return run();
  const prev = DOC;
  DOC = opt.doc === true;
  try {
    return run();
  } finally {
    DOC = prev;
  }
}

/* ---------- inline ---------- */

type MarkType = "bold" | "italic" | "strike" | "link";
interface Span {
  text: string;
  marks: PMMark[];
}
interface Chip {
  chip: string;
  marks: PMMark[];
}
type Piece = Span | Chip | "br";

const MARK_ORDER: readonly string[] = ["suggestAdd", "suggestDel", "link", "bold", "italic", "strike"];

// a field chip: a value tag the fill engine reads ({client.name}, spaces inside the braces kept) or a signing mark ({sign:client}, {date:client})
const PLAIN_STOP = new Set(["\n", "\\", "`", "*", "_", "~", "!", "["]);
const CHIP = /\{(\s*[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\s*|(?:sign|date):[A-Za-z0-9_]+)\}/y;
const sgMark = (
  type: "suggestAdd" | "suggestDel",
  author: string | undefined,
  at: string | undefined,
  sub: boolean,
): PMMark => ({
  type,
  attrs: { author: author ?? "", at: at ?? "", ...(sub ? { sub: true } : {}) },
});
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}_]/u;

function mark(type: MarkType, href?: string, title?: string): PMMark {
  return type === "link" ? { type, attrs: { href: href ?? "", ...(title === undefined ? {} : { title }) } } : { type };
}

/**
 * Searches that remember where they last looked. The text between two searches for the same character is known to hold none, so asking again from a later start costs nothing: a text with thousands
 * of openers that never close is read in one pass, not once per opener.
 */
type SearchCache = Map<string, { from: number; at: number }>;
function nextIdx(src: string, cache: SearchCache, needle: string, from: number): number {
  const c = cache.get(needle);
  if (c && from >= c.from && (c.at === -1 || from <= c.at)) return c.at;
  const at = src.indexOf(needle, from);
  cache.set(needle, { from, at });
  return at;
}
function nextRe(src: string, cache: SearchCache, key: string, re: RegExp, from: number): number {
  const c = cache.get(key);
  if (c && from >= c.from && (c.at === -1 || from <= c.at)) return c.at;
  re.lastIndex = from;
  const m = re.exec(src);
  const at = m ? m.index : -1;
  cache.set(key, { from, at });
  return at;
}
const STOP_URL = /[)\s]/g;
const NOT_SPACE = /\S/g;

/** `[text](href "title")` at `i`, read with the searches above; the same links the old pattern read, in time that does not grow with the openers behind it. */
function linkAt(
  src: string,
  i: number,
  image: boolean,
  cache: SearchCache,
): { len: number; text: string; href: string; title: string | undefined } | null {
  const close = nextIdx(src, cache, "]", i + 1);
  const nl = nextIdx(src, cache, "\n", i + 1);
  if (close < 0 || (nl >= 0 && nl < close)) return null;
  if (close === i + 1 && !image) return null;
  if (src.charAt(close + 1) !== "(") return null;
  const u = close + 2;
  const stop = nextRe(src, cache, "url", STOP_URL, u);
  if (stop < 0 || stop === u) return null;
  const href = src.slice(u, stop);
  const text = src.slice(i + 1, close);
  if (src.charAt(stop) === ")") return { len: stop + 1 - i, text, href, title: undefined };
  // a space after the address: then a quoted title and the closing bracket
  const q = nextRe(src, cache, "ns", NOT_SPACE, stop);
  if (q < 0 || src.charAt(q) !== '"') return null;
  const end = nextIdx(src, cache, '"', q + 1);
  if (end < 0 || src.charAt(end + 1) !== ")") return null;
  return { len: end + 2 - i, text, href, title: src.slice(q + 1, end) };
}

/** Inline markdown to pieces: text with marks, and line breaks. */
function scan(src: string, marks: readonly PMMark[], out: Piece[], before: string): void {
  let buf = "";
  let i = 0;
  const cache: SearchCache = new Map();
  const fails = new Map<string, { from: number; until: number }>();
  const known = (key: string, at: number): boolean => {
    const f = fails.get(key);
    return f !== undefined && at >= f.from && at < f.until;
  };
  const failed = (key: string, at: number, until: number): void => {
    fails.set(key, { from: at, until });
  };
  /** The first of these characters at or after `from`, or never. */
  const firstOf = (chars: string[], from: number): number => {
    let best = Infinity;
    for (const c of chars) {
      const k = nextIdx(src, cache, c, from);
      if (k >= 0 && k < best) best = k;
    }
    return best;
  };
  // the character before this one: every character put in `buf` is the one just behind `i` in `src` (an escape adds the escaped character), so no read of `buf` is needed
  const prev = (): string => (i === 0 ? before : src.charAt(i - 1));
  const flush = (): void => {
    if (buf !== "") out.push({ text: buf, marks: [...marks] });
    buf = "";
  };
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "{") {
      let hit: RegExpExecArray | null = null;
      if (DOC) {
        CHIP.lastIndex = i;
        hit = CHIP.exec(src);
        if (hit) {
          flush();
          out.push({ chip: hit[1] ?? "", marks: [...marks] });
          i += hit[0].length;
          continue;
        }
        const c = criticAt(src, i);
        if (c) {
          flush();
          if (c.kind === "add") scan(c.added, [...marks, sgMark("suggestAdd", c.author, c.at, false)], out, "");
          else if (c.kind === "del") scan(c.old, [...marks, sgMark("suggestDel", c.author, c.at, false)], out, "");
          else {
            scan(c.old, [...marks, sgMark("suggestDel", c.author, c.at, true)], out, "");
            scan(c.added, [...marks, sgMark("suggestAdd", c.author, c.at, true)], out, "");
          }
          i = c.to;
          continue;
        }
      }
      buf += ch;
      i += 1;
      continue;
    }
    // an ordinary letter starts nothing: it is added without cutting the rest of the text off (that copy made a long paragraph cost its length squared)
    if (!PLAIN_STOP.has(ch)) {
      buf += ch;
      i += 1;
      continue;
    }
    const rest = src.slice(i);
    if (ch === "\n") {
      flush();
      out.push("br");
      i += 1;
      continue;
    }
    if (ch === "\\" && rest.length > 1 && ESCAPABLE.test(rest.charAt(1))) {
      buf += rest.charAt(1);
      i += 2;
      continue;
    }
    let m: RegExpExecArray | null = null;
    if (ch === "`" && (m = /^(`+)(?!`)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush();
      const body = (m[2] ?? "").replace(/^ (.*[^ ].*) $/s, "$1");
      out.push({ text: body, marks: [...marks, { type: "code" }] });
      i += m[0].length;
      continue;
    }
    const pv = prev();
    const c1 = src.charAt(i + 1);
    // each kind of span that failed to close at some start is remembered, so a text full of openers that never close is read in one pass
    if (
      (ch === "*" || ch === "_") &&
      c1 === ch &&
      c1 !== "" &&
      /\S/.test(src.charAt(i + 2)) &&
      (ch === "*" || !WORD.test(pv)) &&
      !known(ch + ch, i)
    ) {
      m = (
        ch === "*" ? /^\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)/ : /^__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\p{N}_])/u
      ).exec(rest);
      if (!m) failed(ch + ch, i, Infinity);
      else {
        flush();
        scan(m[1] ?? "", [...marks, mark("bold")], out, "");
        i += m[0].length;
        continue;
      }
    }
    if (ch === "~" && c1 === "~" && /\S/.test(src.charAt(i + 2)) && !known("~~", i)) {
      m = /^~~(?=\S)([\s\S]+?)(?<=\S)~~(?!~)/.exec(rest);
      if (!m) failed("~~", i, Infinity);
      else {
        flush();
        scan(m[1] ?? "", [...marks, mark("strike")], out, "");
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" && c1 !== "*" && /[^\s*]/.test(c1) && !known("*", i)) {
      m = /^\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/.exec(rest);
      if (!m) failed("*", i, firstOf(["*", "\n"], i + 1));
      else {
        flush();
        scan(m[1] ?? "", [...marks, mark("italic")], out, "");
        i += m[0].length;
        continue;
      }
    }
    if (ch === "_" && c1 !== "_" && /[^\s_]/.test(c1) && !WORD.test(pv) && !known("_", i)) {
      m = /^_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/u.exec(rest);
      if (!m) failed("_", i, firstOf(["_", "\n"], i + 1));
      else {
        flush();
        scan(m[1] ?? "", [...marks, mark("italic")], out, "");
        i += m[0].length;
        continue;
      }
    }
    if (ch === "!" && c1 === "[") {
      const l = linkAt(src, i + 1, true, cache);
      if (l) {
        buf += src.slice(i, i + 1 + l.len);
        i += 1 + l.len;
        continue;
      }
    }
    if (ch === "[") {
      const l = linkAt(src, i, false, cache);
      if (l) {
        flush();
        scan(l.text, [...marks.filter((x) => x.type !== "link"), mark("link", l.href, l.title)], out, "");
        i += l.len;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
}

function sameMarks(a: readonly PMMark[], b: readonly PMMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((x) => b.some((y) => y.type === x.type && JSON.stringify(y.attrs ?? {}) === JSON.stringify(x.attrs ?? {})))
  );
}

/** Inline markdown to document nodes (text with marks, hard breaks). Neighbours with the same marks join. */
export function inlineToNodes(src: string, opt?: MdOptions): PMNode[] {
  return withDoc(opt, () => inlineNodes(src));
}
function inlineNodes(src: string): PMNode[] {
  const pieces: Piece[] = [];
  scan(src, [], pieces, "");
  const out: PMNode[] = [];
  for (const p of pieces) {
    if (p === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if ("chip" in p) {
      out.push({ type: "fieldChip", attrs: { raw: p.chip }, ...(p.marks.length > 0 ? { marks: p.marks } : {}) });
      continue;
    }
    if (p.text === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.type === "text" && sameMarks(last.marks ?? [], p.marks))
      last.text = (last.text ?? "") + p.text;
    else out.push({ type: "text", text: p.text, ...(p.marks.length > 0 ? { marks: p.marks } : {}) });
  }
  return out;
}

/** The plain text of inline nodes. */
export function nodesText(nodes: readonly PMNode[] | undefined): string {
  let s = "";
  for (const n of nodes ?? [])
    s +=
      n.type === "hardBreak" ? "\n" : n.type === "fieldChip" ? `{${String(n.attrs?.["raw"] ?? "")}}` : (n.text ?? "");
  return s;
}

/** Text that would not read as itself when parsed gets backslashes before its markup characters; everything else is written as typed. */
function escapeText(text: string): string {
  const n = inlineNodes(text);
  const plain = n.length <= 1 && n.every((x) => x.type === "text" && x.marks === undefined) && nodesText(n) === text;
  if (plain) return text;
  return text.replace(DOC ? /([\\`*_~[\]{])/g : /([\\`*_~[\]])/g, "\\$1");
}

const BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```|\s{0,3}([-*_])(?:\s*\2){2,}\s*$)/;

function markOpen(m: PMMark): string {
  switch (m.type) {
    case "bold":
      return "**";
    case "italic":
      return "*";
    case "strike":
      return "~~";
    case "link":
      return "[";
    case "suggestAdd":
      return m.attrs?.["sub"] === true ? "" : "{++";
    case "suggestDel":
      return m.attrs?.["sub"] === true ? "{~~" : "{--";
    default:
      return "";
  }
}
/** Who and when, after a tracked change; nothing when neither is known. */
function metaOf(m: PMMark): string {
  const a = String(m.attrs?.["author"] ?? "");
  const t = String(m.attrs?.["at"] ?? "");
  return a === "" && t === "" ? "" : `{>>${a}|${t}<<}`;
}
function markClose(m: PMMark): string {
  switch (m.type) {
    case "suggestAdd":
      return `${m.attrs?.["sub"] === true ? "~~}" : "++}"}${metaOf(m)}`;
    case "suggestDel":
      return m.attrs?.["sub"] === true ? "~>" : `--}${metaOf(m)}`;
    case "bold":
      return "**";
    case "italic":
      return "*";
    case "strike":
      return "~~";
    case "link":
      return `](${String(m.attrs?.["href"] ?? "")}${typeof m.attrs?.["title"] === "string" ? ` "${String(m.attrs["title"])}"` : ""})`;
    default:
      return "";
  }
}

/** Document inline nodes to markdown. Marks open and close in a fixed order and keep spaces outside; a line that would read as a block start is escaped. */
export function nodesToInline(nodes: readonly PMNode[] | undefined, opt?: MdOptions): string {
  return withDoc(opt, () => inlineText(nodes));
}

const hasMark = (n: PMNode, type: string, sub: boolean): PMMark | undefined =>
  (n.marks ?? []).find((m) => m.type === type && (m.attrs?.["sub"] === true) === sub);

/** A replacement is written `{~~old~>new~~}` only when its removed part is followed at once by its added part; a half that lost its partner is written as a plain removal or addition. */
function pairedNodes(nodes: readonly PMNode[]): readonly PMNode[] {
  if (!nodes.some((n) => hasMark(n, "suggestDel", true) || hasMark(n, "suggestAdd", true))) return nodes;
  const keep = new Set<number>();
  for (let i = 0; i < nodes.length; i += 1) {
    const d = nodes[i] ? hasMark(nodes[i] as PMNode, "suggestDel", true) : undefined;
    if (!d) continue;
    let j = i;
    while (
      j < nodes.length &&
      nodes[j] &&
      JSON.stringify(hasMark(nodes[j] as PMNode, "suggestDel", true)) === JSON.stringify(d)
    )
      j += 1;
    let k = j;
    while (k < nodes.length && nodes[k] && hasMark(nodes[k] as PMNode, "suggestAdd", true)) k += 1;
    if (k > j) for (let x = i; x < k; x += 1) keep.add(x);
    i = Math.max(i, k - 1);
  }
  return nodes.map((n, i) =>
    keep.has(i) || !(hasMark(n, "suggestDel", true) || hasMark(n, "suggestAdd", true))
      ? n
      : {
          ...n,
          marks: (n.marks ?? []).map((m) =>
            (m.type === "suggestAdd" || m.type === "suggestDel") && m.attrs?.["sub"] === true
              ? { type: m.type, attrs: { author: m.attrs["author"], at: m.attrs["at"] } }
              : m,
          ),
        },
  );
}

function inlineText(raw: readonly PMNode[] | undefined): string {
  const nodes = pairedNodes(raw ?? []);
  let out = "";
  const open: PMMark[] = [];
  let lineStart = true;
  let pend = "";
  const closeTo = (keep: number): void => {
    while (open.length > keep) out += markClose(open.pop() as PMMark);
  };
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      closeTo(0);
      pend = "";
      out += "\n";
      lineStart = true;
      continue;
    }
    const chip = n.type === "fieldChip";
    if (!chip && (n.type !== "text" || n.text === undefined)) continue;
    const body = chip ? `{${String(n.attrs?.["raw"] ?? "")}}` : (n.text as string);
    const ms = (n.marks ?? [])
      .filter((m) => m.type !== "code")
      .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const isCode = !chip && (n.marks ?? []).some((m) => m.type === "code");
    // a chip, and anything inside a tracked change, keeps its own spaces: moving one across a mark would change what was removed or added
    const whole = chip || ms.some((m) => m.type === "suggestAdd" || m.type === "suggestDel");
    const lead = whole ? "" : (/^\s*/.exec(body)?.[0] ?? "");
    const trail = whole ? "" : body.slice(lead.length + body.slice(lead.length).trimEnd().length);
    const core = body.slice(lead.length, body.length - trail.length);
    if (core === "") {
      pend += body;
      continue;
    }
    let keep = 0;
    while (keep < open.length && keep < ms.length && sameMarks([open[keep] as PMMark], [ms[keep] as PMMark])) keep += 1;
    closeTo(keep);
    out += pend + lead;
    pend = "";
    for (let k = keep; k < ms.length; k += 1) {
      out += markOpen(ms[k] as PMMark);
      open.push(ms[k] as PMMark);
    }
    if (isCode) {
      const fence = "`".repeat((core.match(/`+/g) ?? []).reduce((a, b) => Math.max(a, b.length), 0) + 1);
      out += core.startsWith("`") || core.endsWith("`") ? `${fence} ${core} ${fence}` : `${fence}${core}${fence}`;
    } else if (chip) {
      out += core;
    } else {
      let t = escapeText(core);
      if (lineStart && (out === "" || out.endsWith("\n")) && BLOCK_START.test(t)) t = `\\${t}`;
      out += t;
    }
    lineStart = false;
    pend = trail;
  }
  closeTo(0);
  return out;
}

/* ---------- blocks: markdown to document ---------- */

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})([^`]*)$/;
/** A code fence line: indent, the fence, and the first word after it (the language). */
const FENCE = {
  test: (l: string): boolean => FENCE_RE.test(l),
  exec: (l: string): RegExpExecArray | null => {
    const m = FENCE_RE.exec(l);
    if (!m) return null;
    return [m[0], m[1] ?? "", m[2] ?? "", /^\s*(\S*)/.exec(m[3] ?? "")?.[1] ?? ""] as unknown as RegExpExecArray;
  },
};
const HEADING_START = /^\s{0,3}(#{1,6})/;
const HEADING_CLOSE = /\s#+$/;
/**
 * An ATX heading line: up to three spaces, one to six #, then the text, which may end with a closing run of # (after a space). Read from the line's start and end, so a very long
 * heading costs one pass; the regex this replaces backtracked on a long run of spaces.
 */
const HEADING = {
  test: (l: string): boolean => HEADING.exec(l) !== null,
  exec: (l: string): RegExpExecArray | null => {
    const m = HEADING_START.exec(l);
    if (!m) return null;
    const rest = l.slice(m[0].length);
    if (rest !== "" && !/^\s/.test(rest)) return null;
    const body = rest.trimEnd();
    if (body === "") return [l, m[1] ?? "", ""] as unknown as RegExpExecArray;
    const c = HEADING_CLOSE.exec(body);
    const text = (c && c.index >= 1 ? body.slice(1, c.index) : body).trim();
    return [l, m[1] ?? "", text] as unknown as RegExpExecArray;
  },
};
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s{0,3})([-*+])\s+(.*)$/;
const ORDERED = /^(\s{0,3})(\d{1,9})([.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_SEP = /^\s*(?:\|\s*)?:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HTML_START = /^\s{0,3}<(\/?[A-Za-z][\w-]*[\s>/]|\/?[A-Za-z][\w-]*$|!--|\?)/;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s+\S+/;
const INDENTED = /^( {4}|\t)\S/;

const isBlank = (l: string | undefined): boolean => (l ?? "").trim() === "";

function startsBlock(line: string, next: string | undefined): boolean {
  if (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    QUOTE.test(line) ||
    HTML_START.test(line)
  )
    return true;
  const o = ORDERED.exec(line);
  if (o && o[2] === "1") return true;
  return line.includes("|") && next !== undefined && TABLE_SEP.test(next);
}

/* ---------- tables ---------- */

/** The cells of one table line: split on pipes that are not escaped, the outer pipes dropped. */
function splitRow(line: string): string[] {
  const s = line.trim();
  const cells: string[] = [];
  let cur = "";
  let endedOnPipe = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    endedOnPipe = false;
    if (ch === "\\" && i + 1 < s.length) {
      cur += ch + (s[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      endedOnPipe = true;
    } else cur += ch;
  }
  if (!endedOnPipe) cells.push(cur);
  if (s.startsWith("|")) cells.shift();
  return cells.map((c) => c.trim());
}

const ALIGN = (c: string): string => (/^:-+:$/.test(c) ? "c" : /^-+:$/.test(c) ? "r" : /^:-+$/.test(c) ? "l" : "");

/** A pipe table as a table of cells. Null when the header and the divider row disagree on the number of columns (the lines stay raw then). */
function tableNode(lines: readonly string[], tight: boolean): PMNode | null {
  const head = splitRow(lines[0] ?? "");
  const sep = splitRow(lines[1] ?? "");
  if (head.length !== sep.length || head.length === 0) return null;
  const body = lines.slice(2).map((l) => ({ src: l, cells: splitRow(l) }));
  const n = Math.max(head.length, ...body.map((r) => r.cells.length));
  const row = (src: string, cells: string[], header: boolean): PMNode => ({
    type: "mdRow",
    attrs: { src, cols: n },
    content: Array.from({ length: n }, (_, i) => {
      const t = cells[i] ?? "";
      return { type: header ? "mdHeader" : "mdCell", attrs: { src: t }, content: inlineToNodes(t) };
    }),
  });
  return {
    type: "mdTable",
    attrs: { tight, sep: lines[1] ?? "", cols: n, align: sep.map(ALIGN) },
    content: [row(lines[0] ?? "", head, true), ...body.map((r) => row(r.src, r.cells, false))],
  };
}

/** A pipe inside a cell is written escaped. */
function escapePipes(s: string): string {
  let out = "";
  let slashes = 0;
  for (const ch of s) {
    if (ch === "|" && slashes % 2 === 0) out += "\\|";
    else out += ch;
    slashes = ch === "\\" ? slashes + 1 : 0;
  }
  return out;
}
const cellMarkdown = (nodes: readonly PMNode[] | undefined): string =>
  escapePipes(nodesToInline(nodes).replace(/\n/g, "<br>"));

/** A table back to markdown. A row whose cells are as they were read is written exactly as it was read; a changed row is written fresh. */
function tableText(t: PMNode): string {
  const rows = t.content ?? [];
  const ncols = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
  const lines: string[] = [];
  for (const [ri, r] of rows.entries()) {
    const cells = r.content ?? [];
    const texts = cells.map((c) => cellMarkdown(c.content));
    const clean =
      typeof r.attrs?.["src"] === "string" &&
      r.attrs["cols"] === cells.length &&
      cells.every(
        (c, i) =>
          typeof c.attrs?.["src"] === "string" && cellMarkdown(inlineToNodes(c.attrs["src"] as string)) === texts[i],
      );
    if (clean) lines.push(r.attrs?.["src"] as string);
    else lines.push(`| ${Array.from({ length: ncols }, (_, i) => texts[i] ?? "").join(" | ")} |`);
    if (ri === 0) {
      const align = (t.attrs?.["align"] as string[] | undefined) ?? [];
      const sep = t.attrs?.["sep"];
      if (typeof sep === "string" && sep !== "" && t.attrs?.["cols"] === ncols) lines.push(sep);
      else
        lines.push(
          `| ${Array.from({ length: ncols }, (_, i) => {
            const a = align[i] ?? "";
            return a === "c" ? ":---:" : a === "r" ? "---:" : a === "l" ? ":---" : "---";
          }).join(" | ")} |`,
        );
    }
  }
  return lines.join("\n");
}

function raw(kind: string, text: string, tight: boolean): PMNode {
  return { type: "rawBlock", attrs: { kind, tight }, content: text === "" ? [] : [{ type: "text", text }] };
}

/** Lines of one list item body, dedented by the item's content column. Returns the lines and where the item ends. */
function itemBody(
  lines: readonly string[],
  at: number,
  width: number,
): { body: string[]; end: number; spaced: boolean } {
  const body: string[] = [];
  let i = at;
  let spaced = false;
  while (i < lines.length) {
    const l = lines[i] ?? "";
    if (isBlank(l)) {
      // a blank line belongs to the item only when an indented line follows
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      if (j < lines.length && (lines[j] ?? "").search(/\S/) >= width) {
        for (let k = i; k < j; k += 1) body.push("");
        spaced = true;
        i = j;
        continue;
      }
      break;
    }
    if (l.search(/\S/) >= width) {
      body.push(l.slice(width));
      i += 1;
      continue;
    }
    // lazy continuation of a paragraph line
    const last = body[body.length - 1];
    if (last !== undefined && !isBlank(last) && !startsBlock(l, lines[i + 1]) && !/^\s{0,3}(\d{1,9}[.)])\s/.test(l)) {
      body.push(l.trim());
      i += 1;
      continue;
    }
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
    nest += 1;
    let inner: PMNode[];
    try {
      inner = parseBlocks([firstText, ...body], 0);
    } finally {
      nest -= 1;
    }
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
      if (
        j < lines.length &&
        nm &&
        (ordered ? nm[3] === marker : nm[2] === marker) &&
        (nm[1] ?? "").length === lead.length
      ) {
        gapNext = true;
        i = j;
        continue;
      }
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
      attrs: {
        tight: nodes.length === 0 ? tight : true,
        ...(ordered ? { start: startNum, delim: marker } : { marker }),
      },
      content: run,
    });
    run = [];
  };
  for (const it of items) {
    if (runKind !== undefined && (it.task === true) !== (runKind === true)) emit();
    runKind = it.task === true ? true : null;
    run.push(
      it.task === true
        ? { type: "taskItem", attrs: { checked: it.checked, gap: it.gap }, content: it.content }
        : { type: "listItem", attrs: { gap: it.gap }, content: it.content },
    );
  }
  emit();
  return { node: nodes, end: i };
}

/** A block's id, written by a host as a comment line before the block: <!--b:blk_abc123-->. The editor keeps it as the block's blockId and writes it back. */
const BLOCK_MARK = /^<!--b:([A-Za-z0-9_-]{1,64})-->\s*$/;
/** A live block is one line: :::live {json}. The json keeps every key it came with. */
const LIVE_LINE = /^:::live\s+(\{.*\})\s*$/;
export interface LiveBlockAttrs {
  blockId?: string | null;
  type: string;
  spec: unknown;
  view: string;
  /** The line's json as written, kept while type, spec and view are as they were. */ json: string;
  /** Keys of the json other than type, spec and view. */ extra: Record<string, unknown>;
}
const liveSig = (a: { type: unknown; spec: unknown; view: unknown }): string =>
  JSON.stringify([a.type, a.spec, a.view]);

/** The node of one :::live line, or null when its json cannot be read (then the line is kept as written in a raw block). */
export function liveNode(json: string, tight: boolean): PMNode | null {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const { type, spec, view, ...extra } = o as Record<string, unknown>;
  return {
    type: "liveBlock",
    attrs: {
      type: typeof type === "string" ? type : "",
      spec: spec ?? null,
      view: typeof view === "string" ? view : "",
      json,
      extra,
      sig: liveSig({ type, spec, view }),
      tight,
    },
  };
}

/** A new live block, as the node a slash-menu pick inserts (ProseMirror JSON): its type, spec and view. */
export function liveBlockNode(type: string, spec: unknown, view: string): PMNode {
  return { type: "liveBlock", attrs: { type, spec, view, json: "", extra: {}, sig: "", tight: false } };
}

function liveText(a: Record<string, unknown>): string {
  const same =
    typeof a["json"] === "string" && a["sig"] === liveSig({ type: a["type"], spec: a["spec"], view: a["view"] });
  if (same) return `:::live ${String(a["json"])}`;
  const out: Record<string, unknown> = {
    type: a["type"],
    ...(a["spec"] === null || a["spec"] === undefined ? {} : { spec: a["spec"] }),
    ...(a["view"] ? { view: a["view"] } : {}),
    ...((a["extra"] as Record<string, unknown> | undefined) ?? {}),
  };
  return `:::live ${JSON.stringify(out)}`;
}

/** Markdown lines to blocks. */
/** How deep lists and quotes are read inside each other: past this a deeper "- " or "> " is text, so a line of a hundred thousand of them costs a pass, not a pass per level. */
const MAX_NEST = 24;
let nest = 0;

function parseBlocks(lines: readonly string[], depth: number): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  let blank = false;
  const tightNow = (): boolean => !blank && out.length > 0;
  // a block-id comment line leads the block after it; the id is attached once that block exists, and the block keeps how it sat against the one before the comment
  let lead: { id: string; at: number; tight: boolean } | null = null;
  const attach = (): void => {
    if (lead === null || out.length <= lead.at) return;
    const n = out[lead.at] as PMNode;
    n.attrs = { ...(n.attrs ?? {}), blockId: lead.id, tight: lead.tight };
    lead = null;
  };
  while (i < lines.length) {
    attach();
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      blank = true;
      i += 1;
      continue;
    }
    if (depth === 0 && lead === null) {
      const mk = BLOCK_MARK.exec(line);
      if (mk) {
        lead = { id: mk[1] as string, at: out.length, tight: tightNow() };
        i += 1;
        blank = false;
        continue;
      }
    }
    const tight = tightNow();
    blank = false;
    if (depth === 0) {
      const lv = LIVE_LINE.exec(line);
      if (lv) {
        const n = liveNode(lv[1] as string, tight);
        if (n) {
          out.push(n);
          i += 1;
          continue;
        }
      }
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const ind = (fence[1] ?? "").length;
      const closer = new RegExp(
        `^\\s{0,3}${(fence[2] ?? "```").charAt(0) === "`" ? "`" : "~"}{${(fence[2] ?? "```").length},}\\s*$`,
      );
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (closer.test(lines[i] ?? "")) {
          closed = true;
          break;
        }
        body.push((lines[i] ?? "").replace(new RegExp(`^ {0,${ind}}`), ""));
        i += 1;
      }
      i += closed ? 1 : 0;
      out.push({
        type: "codeBlock",
        attrs: { language: fence[3] ?? "", tight, fence: fence[2] ?? "```" },
        content: body.length === 0 ? [] : [{ type: "text", text: body.join("\n") }],
      });
      continue;
    }
    if (depth === 0 && out.length === 0 && line.trim() === "---" && /^---\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j] ?? "")) j += 1;
      if (j < lines.length) {
        out.push(raw("front", lines.slice(i, j + 1).join("\n"), false));
        i = j + 1;
        continue;
      }
    }
    const heading = HEADING.exec(line);
    if (heading && !RULE.test(line)) {
      out.push({
        type: "heading",
        attrs: { level: (heading[1] ?? "#").length, tight },
        content: inlineToNodes(heading[2] ?? ""),
      });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ type: "horizontalRule", attrs: { tight, mark: line.trim() } });
      i += 1;
      continue;
    }
    if (HTML_START.test(line)) {
      const body: string[] = [];
      const comment = /^\s{0,3}<!--/.test(line);
      while (i < lines.length && (comment ? true : !isBlank(lines[i]))) {
        body.push(lines[i] ?? "");
        i += 1;
        if (comment && /-->/.test(body[body.length - 1] ?? "")) break;
      }
      out.push(raw("html", body.join("\n"), tight));
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "") && !isBlank(lines[i + 1])) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      out.push(tableNode(body, tight) ?? raw("table", body.join("\n"), tight));
      continue;
    }
    if (REF_DEF.test(line)) {
      const body: string[] = [];
      while (i < lines.length && REF_DEF.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      out.push(raw("ref", body.join("\n"), tight));
      continue;
    }
    if (nest >= MAX_NEST && (BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line))) {
      // lists and quotes nested this deep are kept as the text they are, byte for byte, rather than read a level at a time
      const kept: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        kept.push(lines[i] ?? "");
        i += 1;
      }
      out.push(raw("nested", kept.join("\n"), tightNow()));
      continue;
    }
    if (nest < MAX_NEST && (BULLET.test(line) || ORDERED.test(line))) {
      const r = parseList(lines, i, tight);
      out.push(...r.node);
      i = r.end;
      continue;
    }
    if (nest < MAX_NEST && QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        body.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
        i += 1;
      }
      // a quote holds blocks; one plain paragraph is the common case
      nest += 1;
      let inner: PMNode[];
      try {
        inner = parseBlocks(body, depth + 1);
      } finally {
        nest -= 1;
      }
      out.push({ type: "blockquote", attrs: { tight }, content: inner.length > 0 ? inner : [{ type: "paragraph" }] });
      continue;
    }
    if (INDENTED.test(line) && out[out.length - 1]?.type !== "paragraph") {
      const body: string[] = [];
      while (i < lines.length) {
        if (INDENTED.test(lines[i] ?? "")) {
          body.push(lines[i] ?? "");
          i += 1;
          continue;
        }
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j += 1;
        if (j > i && j < lines.length && INDENTED.test(lines[j] ?? "")) {
          for (let k = i; k < j; k += 1) body.push(lines[k] ?? "");
          i = j;
          continue;
        }
        break;
      }
      out.push(raw("indented", body.join("\n"), tight));
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      (para.length === 0 || !startsBlock(lines[i] ?? "", lines[i + 1]))
    ) {
      para.push(
        // leading spaces go; trailing spaces go (a closing backslash stays). Written without a pattern: a long run of spaces made the old one cost its length squared
        (lines[i] ?? "").trim(),
      );
      i += 1;
    }
    out.push({ type: "paragraph", attrs: { tight }, content: inlineToNodes(para.join("\n")) });
  }
  attach();
  // a comment with no block after it is kept as it was written
  const left = lead as { id: string; tight: boolean } | null;
  if (left !== null) out.push(raw("html", `<!--b:${left.id}-->`, left.tight));
  return out;
}

/** A whole markdown text to the editor's document. */
export function markdownToDoc(md: string, opt?: MdOptions): PMNode {
  return withDoc(opt, () => toDoc(md));
}
function toDoc(md: string): PMNode {
  const text = md.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const blocks = parseBlocks(lines, 0);
  const d = doc(blocks.length > 0 ? blocks : [{ type: "paragraph" }]);
  return d;
}

/* ---------- blocks: document to markdown ---------- */

function listMarker(list: PMNode, n: number): string {
  if (list.type === "orderedList")
    return `${Number(list.attrs?.["start"] ?? 1) + n}${String(list.attrs?.["delim"] ?? ".")} `;
  return `${String(list.attrs?.["marker"] ?? "-")} `;
}

function indentLines(text: string, pad: string, first: string): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? first + l : l === "" ? "" : pad + l))
    .join("\n");
}

function blockText(b: PMNode): string {
  switch (b.type) {
    case "paragraph":
      return nodesToInline(b.content);
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(b.attrs?.["level"] ?? 1))))} ${nodesToInline(b.content)}`.trimEnd();
    case "horizontalRule":
      return String(b.attrs?.["mark"] ?? "---");
    case "rawBlock":
      return nodesText(b.content);
    case "mdTable":
      return tableText(b);
    case "liveBlock":
      return liveText(b.attrs ?? {});
    case "codeBlock": {
      const body = nodesText(b.content);
      const longest = (body.match(/`{3,}/g) ?? []).reduce((a, x) => Math.max(a, x.length), 2);
      const fence = String(b.attrs?.["fence"] ?? "```");
      const f = fence.startsWith("~") ? fence : "`".repeat(Math.max(fence.length, longest + 1));
      return `${f}${String(b.attrs?.["language"] ?? "")}\n${body}${body === "" ? "" : "\n"}${f}`;
    }
    case "blockquote":
      return blocksToMarkdownBody(b.content ?? [])
        .split("\n")
        .map((l) => (l === "" ? ">" : `> ${l}`))
        .join("\n");
    case "bulletList":
    case "orderedList":
    case "taskList": {
      let text = "";
      for (const [n, it] of (b.content ?? []).entries()) {
        const mk =
          it.type === "taskItem"
            ? `${String(b.attrs?.["marker"] ?? "-")} [${it.attrs?.["checked"] === true ? "x" : " "}] `
            : listMarker(b, n);
        const inner = blocksToMarkdownBody(it.content ?? []);
        if (n > 0) text += it.attrs?.["gap"] === true ? "\n\n" : "\n";
        text += indentLines(inner, " ".repeat(mk.length), mk);
      }
      return text;
    }
    default:
      return "";
  }
}

function blocksToMarkdownBody(blocks: readonly PMNode[]): string {
  let out = "";
  for (const [i, b] of blocks.entries()) {
    if (i > 0) out += b.attrs?.["tight"] === true ? "\n" : "\n\n";
    const id = b.attrs?.["blockId"];
    if (typeof id === "string" && id !== "") out += `<!--b:${id}-->\n`;
    out += blockText(b);
  }
  return out;
}

/** The editor's document back to markdown. The file ends in one newline. */
export function docToMarkdown(d: PMNode, opt?: MdOptions): string {
  return withDoc(opt, () => toMarkdown(d));
}
function toMarkdown(d: PMNode): string {
  const blocks = d.content ?? [];
  if (blocks.length === 1 && blocks[0]?.type === "paragraph" && (blocks[0].content ?? []).length === 0) return "";
  const body = blocksToMarkdownBody(blocks);
  return body === "" ? "" : `${body}\n`;
}

/** Plain text of the document, for a word count or a search index. */
export function docText(d: PMNode): string {
  const out: string[] = [];
  const walk = (n: PMNode): void => {
    if (n.type === "text") {
      out.push(n.text ?? "");
      return;
    }
    if (n.type === "hardBreak") {
      out.push("\n");
      return;
    }
    if (n.type === "fieldChip") {
      out.push(`{${String(n.attrs?.["raw"] ?? "")}}`);
      return;
    }
    for (const c of n.content ?? []) walk(c);
    if (
      ["paragraph", "heading", "codeBlock", "rawBlock", "listItem", "taskItem", "blockquote", "mdRow"].includes(n.type)
    )
      out.push("\n");
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
