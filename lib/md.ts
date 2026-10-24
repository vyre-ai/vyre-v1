// Markdown helpers shared by files, memory notes, previews and search. Small on purpose: no parser, no dependencies, same result on a server, a phone and a browser.

export interface Heading { level: number; text: string; line: number }

/** Split a leading `---` front-matter block (flat `key: value` lines) from the body. Anything the block cannot express is left in the body untouched. */
export function frontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) return { data: {}, body: md };
    data[kv[1]!] = kv[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return { data, body: md.slice(m[0].length) };
}

/** ATX headings (`# Title`), skipping fenced code. Lines are 1-based. */
export function headings(md: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  md.split(/\r?\n/).forEach((raw, i) => {
    const f = /^\s{0,3}(```+|~~~+)/.exec(raw);
    if (f) { fence = fence === null ? f[1]![0]! : fence === f[1]![0] ? null : fence; return; }
    if (fence !== null) return;
    const h = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(raw);
    if (h) out.push({ level: h[1]!.length, text: h[2]!, line: i + 1 });
  });
  return out;
}

/** Outgoing links: `[[Wiki links]]` (with an optional `|label`) and `[text](url)`. */
export function links(md: string): { wiki: string[]; urls: string[] } {
  const wiki = [...md.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)].map((m) => m[1]!.trim());
  const urls = [...md.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]!);
  return { wiki, urls };
}

/** Markdown to readable plain text for search indexes, notifications and previews. */
export function toPlain(md: string): string {
  return frontmatter(md).body
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^\s{0,3}>[ \t]?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A one-line excerpt of at most `max` characters, cut at a word boundary with an ellipsis. */
export function excerpt(md: string, max = 160): string {
  const t = toPlain(md).replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/** Escape text so it renders literally inside Markdown. */
export function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

/** Slug for anchors and file names: lowercase, ascii letters and digits, single dashes. */
export function slug(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
