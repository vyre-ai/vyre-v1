// ui-rows: every list item is a ui/Row, and hover and selection paint the full width of that row.
// V1-SPEC "UI rows" and ARCHITECTURE-V1 10.1.

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isUi, skipped } from "./paths.ts";

const RULE = "ui-rows";

export function appliesUiRows(file: string): boolean {
  if (skipped(file) || !isUi(file)) return false;
  return /\.(?:tsx|jsx)$/.test(file);
}

const EXEMPT = /ui-rows-lint:\s*not a list\b(?:\s*\(([^)]*)\))?/;

/**
 * The exemption comment on the line just above the one holding `index`: `// ui-rows-lint: not a list (<reason>)` (or the same inside a JSX comment). Returns the reason,
 * "" when the comment is there without one, or null when the line above carries no such comment.
 */
function exemptionAbove(source: string, index: number): { reason: string; at: number } | null {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  if (lineStart === 0) return null;
  const prevStart = source.lastIndexOf("\n", lineStart - 2) + 1;
  const prev = source.slice(prevStart, lineStart - 1);
  const m = EXEMPT.exec(prev);
  return m ? { reason: (m[1] ?? "").trim(), at: prevStart + m.index } : null;
}

export function checkUiRows(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  const starts: number[] = [];
  for (const re of [/\.map\s*\(/g, /\brenderItem\s*[:=]/g]) {
    for (const hit of source.matchAll(re)) starts.push(hit.index);
  }
  starts.sort((a, b) => a - b);
  for (const start of starts) {
    // an author's "not a list" note, with a reason, says this .map builds tiles or cards, not list rows
    const ex = exemptionAbove(source, start);
    if (ex) {
      if (ex.reason) continue;
      out.push(finding(RULE, file, source, ex.at, "ui-rows-lint: not a list needs a reason in parentheses"));
      continue;
    }
    // only a callback that returns JSX is list rendering; a data transform (.map(x => x.id), a callback that returns a string or an object) is not
    const tag = returnedJsx(source, start);
    if (!tag) continue;
    if (!isRowTag(tag.tag)) {
      out.push(finding(RULE, file, source, tag.index, "every list item is a ui/Row"));
      continue;
    }
    const end = elementEnd(source, tag.index, tag.tag);
    const slice = source.slice(tag.index, end);
    const openEnd = openingTagEnd(slice, 0);
    const opening = slice.slice(0, openEnd);
    const rest = slice.slice(openEnd);
    const openingPaints = paintsHoverOrSelection(opening);
    const childPaints = paintsHoverOrSelection(rest);
    if (openingPaints && (hasPartialWidth(opening) || hasHorizontalMargin(opening))) {
      out.push(finding(RULE, file, source, tag.index, "hover and selection must be full width"));
    } else if (childPaints && !openingPaints) {
      out.push(finding(RULE, file, source, tag.index + openEnd, "hover and selection must be full width"));
    }
  }
  return out;
}

/**
 * The JSX element a callback hands back, or null when it returns anything else. `start` is the `.map(` or `renderItem:` that opens the callback. The callback is an arrow function or a
 * `function`; its result is JSX when the arrow's body, or a top-level `return` of a block body, begins with `<Tag` (parentheses around it are fine). Returns inside nested functions are
 * not this callback's; a nested `.map(` is looked at on its own.
 */
function returnedJsx(source: string, start: number): { tag: string; index: number } | null {
  const head = source.slice(start, start + 500);
  const arrowAt = head.indexOf("=>");
  const fnAt = head.search(/\bfunction\b/);
  // the callback must be this call's own argument: its parameters close before the call's own parenthesis does
  const stop = arrowAt >= 0 ? (fnAt >= 0 ? Math.min(arrowAt, fnAt) : arrowAt) : fnAt;
  if (stop < 0) return null;
  const floor = source[start] === "." ? 1 : 0;
  let depth = 0;
  for (let k = 0; k < stop; k++) {
    const c = head[k];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth < floor) return null; }
    else if (c === ";") return null;
  }
  let bodyAt: number;
  if (arrowAt >= 0 && (fnAt < 0 || arrowAt < fnAt)) bodyAt = start + arrowAt + 2;
  else if (fnAt >= 0) {
    const brace = source.indexOf("{", start + fnAt);
    if (brace < 0 || brace - start > 500) return null;
    bodyAt = brace;
  } else return null;
  let i = bodyAt;
  while (i < source.length && /[\s(]/.test(source[i] as string)) i++;
  if (source[i] === "{") return jsxReturnIn(source, i);
  return jsxAt(source, i);
}

/** `<Tag` at `i` as the start of an expression. */
function jsxAt(source: string, i: number): { tag: string; index: number } | null {
  if (source[i] !== "<") return null;
  const m = /^<([A-Za-z][\w.]*)/.exec(source.slice(i, i + 200));
  return m ? { tag: m[1] as string, index: i } : null;
}

/** The first top-level `return <Tag` of the block that opens at `open`. */
function jsxReturnIn(source: string, open: number): { tag: string; index: number } | null {
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i++) {
    const c = source[i] as string;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") { quote = c; continue; }
    if (c === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i); if (i < 0) return null; continue; }
    if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i + 2); if (i < 0) return null; i++; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return null; }
    else if (depth === 1 && source.startsWith("return", i) && !/[\w$]/.test(source[i - 1] ?? "") && !/[\w$]/.test(source[i + 6] ?? "")) {
      let j = i + 6;
      while (j < source.length && /[\s(]/.test(source[j] as string)) j++;
      const hit = jsxAt(source, j);
      if (hit) return hit;
    }
  }
  return null;
}

function isRowTag(tag: string): boolean {
  return tag === "Row" || tag.endsWith(".Row");
}

function paintsHoverOrSelection(text: string): boolean {
  return /\b(?:hovered|hover|selected|isSelected|selection)\b/.test(text) && /\bbackground(?:Color)?\b/.test(text);
}

function hasHorizontalMargin(text: string): boolean {
  return /\bmargin(?:Horizontal|Left|Right|Inline|InlineStart|InlineEnd)\b/.test(text);
}

function hasPartialWidth(text: string): boolean {
  for (const hit of text.matchAll(/\bwidth\s*:\s*([^,}\n]+)/g)) {
    const v = hit[1].trim().replace(/;$/, "");
    if (v === '"100%"' || v === "'100%'" || v === "`100%`" || v === '"full"' || v === "'full'" || v === "`full`") continue;
    return true;
  }
  const align = /\balignSelf\s*:\s*([^,}\n]+)/.exec(text);
  if (align) {
    const v = align[1].trim().replace(/;$/, "");
    if (v !== '"stretch"' && v !== "'stretch'" && v !== "`stretch`") return true;
  }
  return false;
}

function openingTagEnd(source: string, start: number): number {
  let quote = "";
  let brace = 0;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === ">" && brace === 0) return i + 1;
  }
  return source.length;
}

function elementEnd(source: string, tagIndex: number, tag: string): number {
  const openEnd = openingTagEnd(source, tagIndex);
  if (/\/\s*>$/.test(source.slice(tagIndex, openEnd))) return openEnd;
  let depth = 1;
  let i = openEnd;
  while (i < source.length && depth > 0) {
    const next = nextTag(source, tag, i);
    if (!next) return source.length;
    if (next.close) {
      depth--;
      const closeEnd = source.indexOf(">", next.index);
      if (closeEnd < 0) return source.length;
      i = closeEnd + 1;
      if (depth === 0) return i;
    } else {
      const nextI = openingTagEnd(source, next.index);
      if (nextI <= next.index) return source.length;
      depth++;
      i = nextI;
    }
  }
  return i;
}

function nextTag(source: string, tag: string, from: number): { index: number; close: boolean } | null {
  const open = "<" + tag;
  const close = "</" + tag;
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      quote = c;
      continue;
    }
    if (source.startsWith(close, i) && !isTagChar(source[i + close.length] || "")) return { index: i, close: true };
    if (source.startsWith(open, i) && !isTagChar(source[i + open.length] || "")) return { index: i, close: false };
  }
  return null;
}

function isTagChar(c: string): boolean {
  return /[\w.]/.test(c);
}
