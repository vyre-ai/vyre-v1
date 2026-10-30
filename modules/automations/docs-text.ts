// A documentation page, read as text for a writer of connectors. The page is data: it is cut to plain text and to a size one turn can hold, and nothing in it is run or followed.
// Scripts, styles and hidden parts are dropped. Links stay so a writer can walk from an index to the reference page, but only to the same host.

export const PAGE_CHARS = 24_000;
export const LINK_LIMIT = 60;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "..." };

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

/** Plain text of a page. A JSON or YAML document is returned as it is. */
export function pageText(raw: string): string {
  const head = raw.trimStart().slice(0, 200).toLowerCase();
  const looksHtml = head.startsWith("<") || /<(html|body|head|div|p|h1|article|main)\b/.test(raw.slice(0, 2000).toLowerCase());
  let text = raw;
  if (looksHtml) {
    text = raw
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre|table|ul|ol|dl|dt|dd|blockquote)\s*>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " ");
    text = decode(text);
  }
  return text
    // control characters and the invisible ones that can hide a line from a reader
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Same-host https links of a page, in the order they appear, without a fragment, at most LINK_LIMIT. */
export function pageLinks(html: string, base: string): string[] {
  let origin: URL;
  try { origin = new URL(base); } catch { return []; }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const href = decode(m[2] ?? m[3] ?? "").trim();
    if (href === "" || href.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    let u: URL;
    try { u = new URL(href, origin); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname !== origin.hostname || u.username !== "" || u.password !== "") continue;
    u.hash = "";
    const s = u.href;
    if (seen.has(s) || s === origin.href) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= LINK_LIMIT) break;
  }
  return out;
}
