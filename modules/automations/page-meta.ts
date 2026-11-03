// The meta of a fetched HTML page, for a link card: title, image address, site name and description, from Open Graph tags, then Twitter tags, then <title> and the description meta.
// The page is never run or rendered: this reads the first 64 KB of the head as text with patterns. Entities are decoded for the few that appear in titles.
export interface PageMeta { title?: string; image?: string; siteName?: string; description?: string; icon?: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9#]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENT[k] !== undefined) return ENT[k]!;
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  }).replace(/\s+/g, " ").trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return out;
}

export function pageMeta(html: string, base: URL): PageMeta {
  const head = html.slice(0, 65_536);
  const metas = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a["property"] ?? a["name"] ?? "").toLowerCase();
    if (key && a["content"] !== undefined && !metas.has(key)) metas.set(key, decode(a["content"]));
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const out: PageMeta = {};
  const title = metas.get("og:title") || metas.get("twitter:title") || (titleTag ? decode(titleTag) : "");
  if (title) out.title = title.slice(0, 300);
  const site = metas.get("og:site_name") || metas.get("application-name") || "";
  if (site) out.siteName = site.slice(0, 120);
  const desc = metas.get("og:description") || metas.get("twitter:description") || metas.get("description") || "";
  if (desc) out.description = desc.slice(0, 500);
  const img = metas.get("og:image") || metas.get("og:image:url") || metas.get("twitter:image") || "";
  if (img) {
    try {
      const u = new URL(img, base);
      if (u.protocol === "https:") out.image = u.toString();
    } catch { /* not an address */ }
  }
  // the site's icon, the fallback picture for a card: an apple-touch-icon (a PNG) first, then any rel icon
  const icons: { rel: string; href: string }[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a["rel"] ?? "").toLowerCase();
    if (a["href"] && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel)) icons.push({ rel, href: a["href"] });
  }
  const pick = icons.find((i) => i.rel.includes("apple-touch-icon")) ?? icons[0];
  if (pick) {
    try {
      const u = new URL(decode(pick.href), base);
      if (u.protocol === "https:") out.icon = u.toString();
    } catch { /* not an address */ }
  }
  return out;
}
