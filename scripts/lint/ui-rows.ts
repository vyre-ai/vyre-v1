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

export function checkUiRows(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  const starts: number[] = [];
  for (const re of [/\.map\s*\(/g, /\brenderItem\s*[:=]/g]) {
    for (const hit of source.matchAll(re)) starts.push(hit.index);
  }
  starts.sort((a, b) => a - b);
  for (const start of starts) {
    const arrow = source.indexOf("=>", start);
    if (arrow < 0 || arrow - start > 500) continue;
    const tag = firstJsxTag(source, arrow + 2, 800);
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

/** First JSX tag after `from`. Skips comparisons and TypeScript generics. */
function firstJsxTag(source: string, from: number, limit: number): { tag: string; index: number } | null {
  const end = Math.min(source.length, from + limit);
  let quote = "";
  for (let i = from; i < end; i++) {
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
    if (c !== "<" || !/[A-Za-z]/.test(source[i + 1] || "")) continue;
    const prev = source.slice(Math.max(0, i - 24), i).replace(/\s+$/, "");
    const token = prev.match(/([\w.]+)$/)?.[1] ?? "";
    if (token && token !== "return") continue;
    const m = /^<([A-Za-z][\w.]*)/.exec(source.slice(i));
    if (m) return { tag: m[1], index: i };
  }
  return null;
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
