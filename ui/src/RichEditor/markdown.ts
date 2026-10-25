// Markdown import and export for the RichEditor (spec 2.16, ARCH 5.6). The document is a Yjs fragment; markdown is the snapshot for search,
// the file on disk and the import path. Blocks match the TipTap starter-kit schema (paragraph, heading, bulletList, orderedList,
// blockquote, codeBlock, horizontalRule; marks bold, italic, strike, code, link), so a block list maps one to one onto the fragment.
// Pure functions, no DOM: the same code runs in the editor, in the WebView bridge and in tests.

export type Mark = "bold" | "italic" | "strike" | "code" | "link";

export interface Run {
  text: string;
  marks: Mark[];
  href?: string;
}

export type Block =
  | { type: "paragraph"; runs: Run[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
  | { type: "bulletList"; items: Run[][] }
  | { type: "orderedList"; items: Run[][] }
  | { type: "blockquote"; runs: Run[] }
  | { type: "codeBlock"; lang: string; text: string }
  | { type: "horizontalRule" };

const MARK_ORDER: readonly Mark[] = ["link", "bold", "italic", "strike", "code"];

/* ---------- inline ---------- */

function sameMarks(a: Run, b: Run): boolean {
  return a.marks.length === b.marks.length && a.marks.every((m) => b.marks.includes(m)) && a.href === b.href;
}

/** Joins neighbours that carry the same marks. */
export function mergeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && sameMarks(last, run)) last.text += run.text;
    else out.push({ text: run.text, marks: [...run.marks], ...(run.href === undefined ? {} : { href: run.href }) });
  }
  return out;
}

function withMark(marks: readonly Mark[], mark: Mark): Mark[] {
  return marks.includes(mark) ? [...marks] : [...marks, mark];
}

/** Inline markdown to runs: `code`, **bold**, ~~strike~~, *italic*, _italic_, [text](href), and backslash escapes. */
export function parseInline(src: string, marks: readonly Mark[] = [], href?: string): Run[] {
  const out: Run[] = [];
  let buf = "";
  let i = 0;
  const flush = (): void => {
    if (buf !== "") out.push({ text: buf, marks: [...marks], ...(href === undefined ? {} : { href }) });
    buf = "";
  };
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = rest.charAt(0);
    if (ch === "\\" && rest.length > 1) { buf += rest.charAt(1); i += 2; continue; }
    let m: RegExpExecArray | null = null;
    if (ch === "`" && (m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ text: m[1] ?? "", marks: withMark(marks, "code"), ...(href === undefined ? {} : { href }) });
      i += m[0].length;
      continue;
    }
    if (ch === "*" && (m = /^\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)/.exec(rest))) {
      flush(); out.push(...parseInline(m[1] ?? "", withMark(marks, "bold"), href)); i += m[0].length; continue;
    }
    if (ch === "~" && (m = /^~~(?=\S)([\s\S]+?)(?<=\S)~~(?!~)/.exec(rest))) {
      flush(); out.push(...parseInline(m[1] ?? "", withMark(marks, "strike"), href)); i += m[0].length; continue;
    }
    if ((ch === "*" && (m = /^\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?!\*)/.exec(rest))) || (ch === "_" && (m = /^_(?=[^\s_])([^_]+?)(?<=[^\s_])_(?![\w_])/.exec(rest)))) {
      flush(); out.push(...parseInline(m[1] ?? "", withMark(marks, "italic"), href)); i += m[0].length; continue;
    }
    if (ch === "[" && (m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush(); out.push(...parseInline(m[1] ?? "", withMark(marks, "link"), m[2] ?? "")); i += m[0].length; continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return mergeRuns(out);
}

function escapeText(text: string): string {
  return text.replace(/([\\`*_~[\]])/g, "\\$1");
}

/** Runs to inline markdown. Marks wrap in a fixed order so the same runs always give the same text. */
export function renderInline(runs: readonly Run[]): string {
  let out = "";
  for (const run of runs) {
    let s = run.marks.includes("code") ? run.text : escapeText(run.text);
    if (run.marks.includes("code")) s = `\`${s}\``;
    for (const mark of [...MARK_ORDER].reverse()) {
      if (!run.marks.includes(mark) || mark === "code") continue;
      if (mark === "strike") s = `~~${s}~~`;
      else if (mark === "italic") s = `*${s}*`;
      else if (mark === "bold") s = `**${s}**`;
      else if (mark === "link") s = `[${s}](${run.href ?? ""})`;
    }
    out += s;
  }
  return out;
}

export function plainText(runs: readonly Run[]): string {
  let out = "";
  for (const r of runs) out += r.text;
  return out;
}

/* ---------- blocks ---------- */

const FENCE = /^```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Markdown to blocks. Lists are one level; nested structure is flattened into the list's items. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line);
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") { i += 1; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) { body.push(lines[i] ?? ""); i += 1; }
      i += 1;
      blocks.push({ type: "codeBlock", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: Math.min(6, (heading[1] ?? "#").length) as 1 | 2 | 3 | 4 | 5 | 6, runs: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (RULE.test(line)) { blocks.push({ type: "horizontalRule" }); i += 1; continue; }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const items: Run[][] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const m = ordered ? ORDERED.exec(l) : BULLET.exec(l);
        if (!m) break;
        items.push(parseInline(m[1] ?? ""));
        i += 1;
      }
      blocks.push(ordered ? { type: "orderedList", items } : { type: "bulletList", items });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) { body.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? ""); i += 1; }
      blocks.push({ type: "blockquote", runs: parseInline(body.join("\n")) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && (para.length === 0 || !startsBlock(lines[i] ?? ""))) { para.push(lines[i] ?? ""); i += 1; }
    blocks.push({ type: "paragraph", runs: parseInline(para.join("\n")) });
  }
  return blocks;
}

/** Blocks to markdown, blocks separated by a blank line. */
export function renderMarkdown(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph": parts.push(renderInline(b.runs)); break;
      case "heading": parts.push(`${"#".repeat(b.level)} ${renderInline(b.runs)}`); break;
      case "bulletList": parts.push(b.items.map((r) => `- ${renderInline(r)}`).join("\n")); break;
      case "orderedList": parts.push(b.items.map((r, n) => `${n + 1}. ${renderInline(r)}`).join("\n")); break;
      case "blockquote": parts.push(renderInline(b.runs).split("\n").map((l) => `> ${l}`).join("\n")); break;
      case "codeBlock": parts.push(`\`\`\`${b.lang}\n${b.text}\n\`\`\``); break;
      case "horizontalRule": parts.push("---"); break;
      default: break;
    }
  }
  return parts.join("\n\n") + (parts.length > 0 ? "\n" : "");
}

/** The text a search index or a word count reads. */
export function blocksToText(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "heading" || b.type === "blockquote") out.push(plainText(b.runs));
    else if (b.type === "bulletList" || b.type === "orderedList") for (const item of b.items) out.push(plainText(item));
    else if (b.type === "codeBlock") out.push(b.text);
  }
  return out.join("\n");
}
