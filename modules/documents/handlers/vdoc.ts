// documents: the Vyre document, a template written as Markdown (lane r42-docs). The same blanks and the same rules as a Word template (fill.ts): {client.name} reads a value,
// {#items}...{/items} repeats or shows, {^flag}...{/flag} shows when the flag is false, a missing value stops the document and names itself, and formats come from the tag name.
// Two marks are its own: {sign:role} is where a signer signs and {date:role} where the date of that signature goes (a paragraph that holds one is a signing row; "||" splits it into
// columns and the words in a column are printed under its line), and {page:break} starts a new page.
// A value is never read as Markdown: values are put in after the text is parsed, so a name with a star or a pipe in it changes nothing but its own letters.
// Nothing here writes or rewrites document text with a model. Pure functions over text; no file, no database, no network.

import { FillError, lookup, printed } from "./fill.ts";
import type { Excerpt, Placeholders, Problems } from "./fill.ts";

export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
}
export interface SignToken {
  kind: "signature" | "date";
  role: string;
}
export interface SignColumn {
  tokens: SignToken[];
  caption: Run[];
}
export type Block =
  | { t: "h"; level: 1 | 2 | 3; runs: Run[] }
  | { t: "p"; runs: Run[]; quote?: boolean }
  | { t: "li"; ordered: boolean; marker: string; depth: number; runs: Run[] }
  | { t: "hr" }
  | { t: "break" }
  | { t: "table"; head: Run[][]; rows: Run[][][] }
  | { t: "sign"; cols: SignColumn[] };

/** The most a Vyre document template may weigh. */
export const MAX_MD_BYTES = 1024 * 1024;

const TAG = /\{([#^/]?)\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*|\.)\s*\}/g;
const MARK = /\{(sign|date):([A-Za-z0-9_]+)\}/g;
// a filled value travels through the Markdown parse as two private-use letters around its number, and is put in afterwards
const OPEN = "";
const CLOSE = "";
const HELD = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

/** The text of a template file: UTF-8, front matter dropped (a template's settings are kept with its mark, not in the file). */
export function textOf(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new FillError("bad_input", "the template is empty");
  if (bytes.length > MAX_MD_BYTES)
    throw new FillError("too_big", `the template is ${bytes.length} bytes; the most is ${MAX_MD_BYTES}`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FillError("bad_input", "that is not a text file");
  }
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // suggestions an editor left in the text ({++add++} {--delete--} {~~old~>new~~}) are not part of the document until accepted: they would print as letters
  if (/\{(\+\+|--|~~)/.test(text.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "")))
    throw new FillError("bad_template", "the document still has suggested changes in it; accept or reject them first");
  const fm = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  return fm ? text.slice(fm[0].length) : text;
}

// ---- reading the sections ----

interface Piece {
  /** text between tags, a plain tag, or a section with its own pieces */
  k: "text" | "tag" | "section";
  text?: string;
  name?: string;
  inverted?: boolean;
  inner?: Piece[];
}

/** A tag alone on its line takes the line with it, so a repeat around list items or table rows leaves no empty paragraph behind. */
function ownLine(src: string, from: number, to: number): { from: number; to: number } {
  const lineStart = src.lastIndexOf("\n", from - 1) + 1;
  const nl = src.indexOf("\n", to);
  const lineEnd = nl < 0 ? src.length : nl;
  if (src.slice(lineStart, from).trim() === "" && src.slice(to, lineEnd).trim() === "")
    return { from: lineStart, to: nl < 0 ? src.length : nl + 1 };
  return { from, to };
}

function pieces(src: string): Piece[] {
  const root: Piece[] = [];
  const stack: { name: string; inverted: boolean; into: Piece[] }[] = [];
  let into = root;
  let at = 0;
  for (const m of src.matchAll(TAG)) {
    const kind = m[1] as string;
    const name = m[2] as string;
    let from = m.index;
    let to = from + m[0].length;
    if (kind !== "") ({ from, to } = ownLine(src, from, to));
    if (from > at) into.push({ k: "text", text: src.slice(at, from) });
    else if (from < at) {
      // the line this tag owns began before the last tag ended: only possible for two section tags on one line, which then own nothing
      from = m.index;
      to = from + m[0].length;
      if (from > at) into.push({ k: "text", text: src.slice(at, from) });
    }
    at = to;
    if (kind === "") into.push({ k: "tag", name });
    else if (kind === "/") {
      const open = stack.pop();
      if (!open || open.name !== name)
        throw new FillError(
          "bad_template",
          `the template closes {/${name}} ${open ? `inside {${open.inverted ? "^" : "#"}${open.name}}` : "without opening it"}`,
        );
      into = stack.length > 0 ? (stack[stack.length - 1] as { into: Piece[] }).into : root;
    } else {
      if (name === ".") throw new FillError("bad_template", "a section needs a name");
      const inner: Piece[] = [];
      into.push({ k: "section", name, inverted: kind === "^", inner });
      stack.push({ name, inverted: kind === "^", into: inner });
      into = inner;
    }
  }
  const left = stack.pop();
  if (left)
    throw new FillError(
      "bad_template",
      `the template opens {${left.inverted ? "^" : "#"}${left.name}} and never closes it`,
    );
  if (at < src.length) into.push({ k: "text", text: src.slice(at) });
  return root;
}

const holdsTags = (ps: Piece[]): boolean =>
  ps.some((p) => p.k === "tag" || (p.k === "section" && holdsTags(p.inner ?? [])));

export interface Asked extends Placeholders {
  /** The signer roles the template names with {sign:role}, in the order they first appear: the first is signer 1. */
  roles: string[];
}

/** The names a Vyre document asks for, in the shape a Word template answers (fill.ts placeholders), and its signer roles. */
export function mdPlaceholders(text: string): Asked {
  const names: string[] = [];
  const loops: string[] = [];
  const conditions: string[] = [];
  const loopFields: Record<string, string[]> = {};
  const loopLeaves: Record<string, string[]> = {};
  const add = (list: string[], n: string): void => {
    if (!list.includes(n)) list.push(n);
  };
  const leaves = (ps: Piece[], acc: string[]): string[] => {
    for (const p of ps) {
      if (p.k === "tag" && p.name !== ".") add(acc, p.name as string);
      else if (p.k === "section") leaves(p.inner ?? [], acc);
    }
    return acc;
  };
  const walk = (ps: Piece[]): void => {
    for (const p of ps) {
      if (p.k === "tag") {
        if (p.name !== ".") add(names, p.name as string);
      } else if (p.k === "section") {
        const name = p.name as string;
        const inner = p.inner ?? [];
        if (!p.inverted && holdsTags(inner)) {
          add(loops, name);
          loopFields[name] = [
            ...new Set([
              ...(loopFields[name] ?? []),
              ...inner.flatMap((x) =>
                x.k === "tag" && x.name !== "." ? [(x.name as string).split(".")[0] as string] : [],
              ),
            ]),
          ];
          loopLeaves[name] = [...new Set([...(loopLeaves[name] ?? []), ...leaves(inner, [])])];
        } else {
          add(conditions, name);
          // what an inverted section shows is the document's own text: its tags are the document's
          walk(inner);
        }
      }
    }
  };
  walk(pieces(text));
  const roles: string[] = [];
  for (const m of text.matchAll(MARK)) if (m[1] === "sign") add(roles, m[2] as string);
  for (const m of text.matchAll(MARK))
    if (m[1] === "date" && !roles.includes(m[2] as string))
      throw new FillError("bad_template", `the template has {date:${m[2]}} and no {sign:${m[2]}}`);
  return { names, loops: loops.filter((l) => !conditions.includes(l)), conditions, loopFields, loopLeaves, roles };
}

// ---- filling ----

interface Held {
  field: string;
  shown: string;
}
interface State {
  held: Held[];
  missing: Set<string>;
  problems: Problems;
}

const blank = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function expand(ps: Piece[], scopes: unknown[], st: State): string {
  let out = "";
  for (const p of ps) {
    if (p.k === "text") out += p.text ?? "";
    else if (p.k === "tag") {
      const name = p.name as string;
      const raw = name === "." ? scopes[scopes.length - 1] : lookup(scopes, name);
      if (blank(raw)) {
        st.missing.add(name);
        continue;
      }
      const shown = String(printed(raw, name, st.problems));
      if (shown === "") continue;
      st.held.push({ field: name, shown });
      out += `${OPEN}${st.held.length - 1}${CLOSE}`;
    } else {
      const name = p.name as string;
      const inner = p.inner ?? [];
      const v = lookup(scopes, name);
      if (p.inverted) {
        if (v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0))
          out += expand(inner, scopes, st);
        continue;
      }
      if (Array.isArray(v)) for (const item of v) out += expand(inner, [...scopes, item], st);
      else if (v === undefined || v === null || v === "") {
        // a section that holds blanks of its own needs a list or a true/false; one that holds only words reads false when absent
        if (holdsTags(inner)) st.missing.add(name);
      } else if (v !== false) out += expand(inner, v !== null && typeof v === "object" ? [...scopes, v] : scopes, st);
    }
  }
  return out;
}

export interface Rendered {
  blocks: Block[];
  /** every filled value, in the order it was put in */
  held: Held[];
  missing: string[];
  used: string[];
  roles: string[];
  /** the filled text as Markdown, each value escaped so it reads as its own letters */
  markdown: string;
}

const escapeMd = (text: string): string => text.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");

/** Fill the text with the values. Never throws for a missing value: the caller decides (fill refuses, preview lists). An unprintable value is refused here, as in a Word template. */
export function mdRender(text: string, values: Record<string, unknown>): Rendered {
  const asked = mdPlaceholders(text);
  const st: State = { held: [], missing: new Set(), problems: new Map() };
  const expanded = expand(pieces(text), [values], st);
  if (st.problems.size > 0) {
    const fields = [...st.problems.keys()].sort();
    throw new FillError(
      "unprintable",
      `the document was not made: ${fields.map((f) => `${f} ${st.problems.get(f)}`).join("; ")}`,
      fields,
    );
  }
  const value = (n: string): string => st.held[Number(n)]?.shown ?? "";
  const blocks = parse(expanded).map((b) => settle(b, value));
  return {
    blocks,
    held: st.held,
    missing: [...st.missing].sort(),
    used: [...asked.names, ...asked.loops, ...asked.conditions],
    roles: asked.roles,
    markdown: expanded.replace(HELD, (_, n: string) => escapeMd(value(n))),
  };
}

/** The filled paragraphs as plain text, each filled value located by offsets into its paragraph (the same shape a Word preview answers). */
export function mdExcerpt(text: string, values: Record<string, unknown>): { excerpt: Excerpt[]; missing: string[] } {
  const asked = mdPlaceholders(text);
  const st: State = { held: [], missing: new Set(), problems: new Map() };
  const expanded = expand(pieces(text), [values], st);
  if (st.problems.size > 0) {
    const fields = [...st.problems.keys()].sort();
    throw new FillError(
      "unprintable",
      `the document was not made: ${fields.map((f) => `${f} ${st.problems.get(f)}`).join("; ")}`,
      fields,
    );
  }
  void asked;
  const excerpt: Excerpt[] = [];
  const say = (runs: Run[]): void => {
    if (excerpt.length >= 200) return;
    const raw = runs.map((r) => r.text).join("");
    let out = "";
    const filled: Excerpt["filled"] = [];
    let last = 0;
    for (const m of raw.matchAll(HELD)) {
      out += raw.slice(last, m.index);
      const h = st.held[Number(m[1])];
      const shown = h?.shown ?? "";
      filled.push({ from: out.length, to: out.length + shown.length, field: h?.field ?? "?" });
      out += shown;
      last = m.index + m[0].length;
    }
    out += raw.slice(last);
    if (out.trim() !== "") excerpt.push({ text: out, filled });
  };
  for (const b of parse(expanded)) {
    if (b.t === "h" || b.t === "p" || b.t === "li") say(b.runs);
    else if (b.t === "table") for (const row of [b.head, ...b.rows]) for (const cell of row) say(cell);
    else if (b.t === "sign") for (const c of b.cols) say(c.caption);
  }
  return { excerpt, missing: [...st.missing].sort() };
}

const settleRuns = (runs: Run[], value: (n: string) => string): Run[] =>
  runs.map((r) => ({ ...r, text: r.text.replace(HELD, (_, n: string) => value(n)) }));

function settle(b: Block, value: (n: string) => string): Block {
  switch (b.t) {
    case "h":
    case "p":
    case "li":
      return { ...b, runs: settleRuns(b.runs, value) };
    case "table":
      return {
        ...b,
        head: b.head.map((c) => settleRuns(c, value)),
        rows: b.rows.map((r) => r.map((c) => settleRuns(c, value))),
      };
    case "sign":
      return { ...b, cols: b.cols.map((c) => ({ ...c, caption: settleRuns(c.caption, value) })) };
    default:
      return b;
  }
}

// ---- the Markdown a document is written in: headings, paragraphs, lists, a quote, a rule, a table, bold and italic ----

/** Bold and italic, links as their words, code as its letters, a backslash before a mark keeps it a letter. */
/**
 * Links and pictures keep their text only: `[text](address)` and `![text](address)` become `text`. A linear scan with the nearest closing bracket remembered, so a document of nothing but opening brackets
 * costs one pass (a regex per start made every `[` read to the end). The text is at most 200 letters on one line and the address at most 500.
 */
function stripLinks(src: string): string {
  if (!src.includes("](")) return src;
  let out = "";
  let at = 0;
  let close = -2; // the nearest "]" at or after the scan position, -1: none left
  let newline = -2;
  let paren = -2; // the nearest ")" at or after the address start, -1: none left
  for (let i = src.indexOf("["); i >= 0; i = src.indexOf("[", i + 1)) {
    if (i < at) continue;
    if (close !== -1 && close < i) close = src.indexOf("]", i);
    if (close === -1) break;
    if (newline !== -1 && newline < i) newline = src.indexOf("\n", i);
    const j = close;
    if (j - i - 1 > 200 || (newline !== -1 && newline < j) || src[j + 1] !== "(") continue;
    if (paren !== -1 && paren < j + 2) paren = src.indexOf(")", j + 2);
    if (paren === -1) break;
    const k = paren;
    if (k - j - 2 > 500 || src.slice(j + 2, k).includes("\n")) continue;
    // a picture's "!" goes with it
    const from = i > at && src[i - 1] === "!" ? i - 1 : i;
    out += src.slice(at, from) + src.slice(i + 1, j);
    at = k + 1;
  }
  return out + src.slice(at);
}

export function inline(src: string): Run[] {
  const out: Run[] = [];
  let b = false;
  let i = false;
  let buf = "";
  const flush = (): void => {
    if (buf === "") return;
    const last = out[out.length - 1];
    if (last && Boolean(last.b) === b && Boolean(last.i) === i) last.text += buf;
    else out.push({ text: buf, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) });
    buf = "";
  };
  // twice: stripping a picture can leave a link made of what was around it, which the two passes of the regexes this replaced also stripped
  const s = stripLinks(stripLinks(src)).replace(/~~(.*?)~~/g, "$1");
  for (let k = 0; k < s.length; k++) {
    const c = s[k] as string;
    if (c === "\\" && k + 1 < s.length && /[\\`*_{}\[\]()#+\-.!|>~]/.test(s[k + 1] as string)) {
      buf += s[k + 1];
      k++;
    } else if ((c === "*" || c === "_") && s[k + 1] === c) {
      flush();
      b = !b;
      k++;
    } else if (c === "*" || (c === "_" && (k === 0 || /\W/.test(s[k - 1] as string) || /\W|$/.test(s[k + 1] ?? "")))) {
      flush();
      i = !i;
    } else if (c === "`") {
      continue;
    } else buf += c;
  }
  flush();
  return out;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** The blocks of a document. A line break inside a paragraph is kept when the line ends with two spaces or a backslash; otherwise lines of one paragraph join with a space. */
/** The line under a table's head: `| --- | :---: |`, each cell two or more dashes with an optional colon at either end. Cells are cut by hand, so a long line of spaces or dashes is read once. */
function isTableRule(line: string): boolean {
  // spaces and tabs only, as the pattern this replaced: not every character String.trim calls whitespace
  const cut = (x: string): string => {
    let a = 0;
    let b = x.length;
    while (a < b && (x[a] === " " || x[a] === "\t")) a++;
    while (b > a && (x[b - 1] === " " || x[b - 1] === "\t")) b--;
    return x.slice(a, b);
  };
  let t = cut(line);
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  if (t === "") return false;
  for (const cell of t.split("|")) {
    const c = cut(cell);
    let a = 0;
    let b = c.length;
    if (c[a] === ":") a++;
    if (b > a && c[b - 1] === ":") b--;
    if (b - a < 2) return false;
    for (let k = a; k < b; k++) if (c[k] !== "-") return false;
  }
  return true;
}

export function parse(md: string): Block[] {
  // CRLF and a lone CR are line ends like LF: a table rule that ends in a carriage return is still a rule
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let quote = false;
  const endPara = (): void => {
    if (para.length === 0) return;
    let text = "";
    para.forEach((l, n) => {
      // trailing spaces counted by hand: the regex form re-read a long run of spaces from every position
      let e = l.length;
      while (e > 0 && l[e - 1] === " ") e--;
      const spaces = l.length - e;
      const hard = spaces >= 2 || l.endsWith("\\");
      text += (spaces >= 2 ? l.slice(0, e) : l.endsWith("\\") ? l.slice(0, -1) : l).trim();
      if (n < para.length - 1) text += hard ? "\n" : " ";
    });
    para = [];
    if (MARK.test(text)) {
      MARK.lastIndex = 0;
      out.push({
        t: "sign",
        cols: text.split("||").map((col) => {
          const tokens: SignToken[] = [];
          for (const m of col.matchAll(MARK))
            tokens.push({ kind: m[1] === "sign" ? "signature" : "date", role: m[2] as string });
          return { tokens, caption: inline(col.replace(MARK, "").trim()) };
        }),
      });
    } else out.push({ t: "p", runs: inline(text), ...(quote ? { quote: true } : {}) });
    quote = false;
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] as string;
    const line = raw.trimEnd();
    if (line.trim() === "") {
      endPara();
      continue;
    }
    // a heading: the lazy form of this match was quadratic on a line of spaces; the closing hashes and spaces are cut by hand
    const h = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (h) {
      endPara();
      let text = h[2] as string;
      let e = text.length;
      while (e > 0 && text[e - 1] === "#") e--;
      while (e > 0 && (text[e - 1] === " " || text[e - 1] === "\t")) e--;
      text = text.slice(0, e);
      out.push({ t: "h", level: Math.min((h[1] as string).length, 3) as 1 | 2 | 3, runs: inline(text) });
      continue;
    }
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      endPara();
      out.push({ t: "hr" });
      continue;
    }
    if (/^\s*\{page:break\}\s*$/.test(line)) {
      endPara();
      out.push({ t: "break" });
      continue;
    }
    const li = /^(\s*)([-*+]|\d{1,4}[.)])[ \t]+(.*)$/.exec(line);
    if (li) {
      endPara();
      const marker = li[2] as string;
      const ordered = /\d/.test(marker);
      out.push({
        t: "li",
        ordered,
        marker: ordered ? `${parseInt(marker, 10)}.` : "•",
        depth: Math.min(Math.floor((li[1] as string).replace(/\t/g, "  ").length / 2), 3),
        runs: inline((li[3] as string).replace(/^\[[ xX]\][ \t]+/, "")),
      });
      continue;
    }
    if (line.trimStart().startsWith("|") && isTableRule(lines[n + 1] ?? "")) {
      endPara();
      const head = cells(line).map(inline);
      const rows: Run[][][] = [];
      n += 2;
      while (n < lines.length && (lines[n] as string).trimStart().startsWith("|")) {
        const row = cells(lines[n] as string).map(inline);
        while (row.length < head.length) row.push([]);
        rows.push(row.slice(0, head.length));
        n++;
      }
      n--;
      out.push({ t: "table", head, rows });
      continue;
    }
    const q = /^ {0,3}>[ \t]?(.*)$/.exec(line);
    if (q) {
      if (para.length > 0 && !quote) endPara();
      quote = true;
      para.push(q[1] as string);
      continue;
    }
    if (quote) endPara();
    para.push(raw);
  }
  endPara();
  return out;
}
