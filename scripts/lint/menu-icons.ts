// menu-icons: in any menu every item has an icon or none does (V1-SPEC section 1, D51).

import { finding, matchDelim } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isUi, skipped } from "./paths.ts";

const RULE = "menu-icons";

export function appliesMenuIcons(file: string): boolean {
  if (skipped(file) || !isUi(file)) return false;
  return /\.(?:tsx|jsx)$/.test(file);
}

type Item = { index: number; icon: boolean; separator: boolean; counted: boolean };

export function checkMenuIcons(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  for (const group of groups(source)) {
    const items = group.filter((item) => item.counted && !item.separator);
    if (items.length < 2) continue;
    const icons = items.filter((item) => item.icon).length;
    if (icons !== 0 && icons !== items.length) {
      out.push(finding(RULE, file, source, items[0].index, "in any menu every item has an icon or none does"));
    }
  }
  return out;
}

function groups(source: string): Item[][] {
  const out: Item[][] = [];
  for (const hit of source.matchAll(/(?:items|menu|menuItems)\s*=\s*\{\s*\[/g)) {
    const prop = /^(items|menu|menuItems)/.exec(hit[0])?.[1];
    if (prop === "items" && !/<Menu\b/.test(source.slice(Math.max(0, hit.index - 800), hit.index))) continue;
    const open = hit.index + hit[0].lastIndexOf("[");
    const body = source.slice(open, matchDelim(source, open, "[", "]"));
    out.push(objectItems(body, open));
  }
  for (const hit of source.matchAll(/<(Menu)\b(?!\.)/g)) {
    const openEnd = tagEnd(source, hit.index);
    if (openEnd < 0 || /\/\s*>$/.test(source.slice(hit.index, openEnd))) continue;
    const closeAt = source.indexOf("</Menu>", openEnd);
    const inner = source.slice(openEnd, closeAt < 0 ? source.length : closeAt);
    const items: Item[] = [];
    for (const tag of inner.matchAll(/<(?:Menu\.Item|Item)\b([^>]*)\/?\s*>/g)) {
      const chunk = tag[1];
      items.push({
        index: openEnd + tag.index,
        icon: propIcon(chunk),
        separator: /\brole\s*=\s*['"]separator['"]/.test(chunk),
        counted: true,
      });
    }
    if (items.length) out.push(items);
  }
  return out;
}

function objectItems(body: string, base: number): Item[] {
  const items: Item[] = [];
  let quote = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
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
    if (c !== "{") continue;
    const end = matchDelim(body, i, "{", "}");
    const text = body.slice(i, end);
    const separator = /\bseparator\s*:\s*true\b/.test(text) || /\b(?:type|kind)\s*:\s*['"]separator['"]/.test(text);
    const counted = separator || /\b(?:label|title|name)\s*:/.test(text);
    items.push({ index: base + i, icon: keyIcon(text), separator, counted });
    i = end - 1;
  }
  return items;
}

function keyIcon(text: string): boolean {
  const m = /\bicon\s*:\s*([^,}\n]+)/.exec(text);
  if (!m) return false;
  return !/^(?:null|undefined|false)\b/.test(m[1].trim());
}

function propIcon(chunk: string): boolean {
  const m = /\bicon\s*=\s*(\{[^}]*\}|['"][^'"]*['"])/.exec(chunk);
  if (!m) return false;
  return !/^\{(?:null|undefined|false)\s*\}$/.test(m[1].trim());
}

function tagEnd(source: string, start: number): number {
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
  return -1;
}
