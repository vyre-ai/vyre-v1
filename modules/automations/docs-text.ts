// What an agent reads from an API docs page: plain text, the links on the same host, and for an OpenAPI document one line per operation. The page is data, not a prompt: nothing in it is run,
// and the text is cut. A search word returns only the passages around it, so a long reference does not fill the turn.

export interface DocsView {
  kind: "openapi" | "html" | "text";
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
}

const MAX_TEXT = 12_000;
const MAX_LINKS = 40;
const WINDOW = 700;

function decode(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlText(html: string): string {
  return decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function linksOf(html: string, base: URL): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(decode(m[1]!), base); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname !== base.hostname) continue;
    u.hash = "";
    const key = u.href;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = htmlText(m[2]!).slice(0, 80);
    if (text === "") continue;
    out.push({ text, url: key });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** One line per operation: `GET /domains: List domains`. */
function openApiLines(doc: unknown): string[] | null {
  const paths = (doc as { paths?: unknown } | null)?.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return null;
  const lines: string[] = [];
  const servers = (doc as { servers?: { url?: unknown }[] }).servers;
  if (Array.isArray(servers) && typeof servers[0]?.url === "string") lines.push(`Server: ${servers[0].url}`);
  const auth = (doc as { components?: { securitySchemes?: Record<string, { type?: unknown; scheme?: unknown }> } }).components?.securitySchemes;
  if (auth) lines.push(`Auth: ${Object.entries(auth).map(([k, v]) => `${k} (${String(v?.type ?? "")}${v?.scheme ? ` ${String(v.scheme)}` : ""})`).join(", ")}`);
  for (const [p, ops] of Object.entries(paths as Record<string, Record<string, { summary?: unknown; operationId?: unknown }>>)) {
    for (const m of METHODS) {
      const op = ops?.[m];
      if (!op) continue;
      lines.push(`${m.toUpperCase()} ${p}: ${typeof op.summary === "string" ? op.summary : typeof op.operationId === "string" ? op.operationId : ""}`.trimEnd());
    }
  }
  return lines;
}

/** The passages around each place `focus` appears (case-insensitive), merged when they touch. Nothing matched returns null. */
export function around(text: string, focus: string): string | null {
  const needle = focus.trim().toLowerCase();
  if (needle === "") return null;
  const hay = text.toLowerCase();
  const spans: [number, number][] = [];
  for (let at = hay.indexOf(needle); at >= 0 && spans.length < 12; at = hay.indexOf(needle, at + needle.length)) {
    const s = Math.max(0, at - WINDOW / 2), e = Math.min(text.length, at + needle.length + WINDOW);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = e; else spans.push([s, e]);
  }
  return spans.length === 0 ? null : spans.map(([s, e]) => text.slice(s, e).trim()).join("\n...\n");
}

export function docsView(raw: string, base: URL, focus?: string): DocsView {
  let body = raw.trim();
  let kind: DocsView["kind"] = "text";
  let links: DocsView["links"] = [];
  if (body.startsWith("{")) {
    try {
      const lines = openApiLines(JSON.parse(body));
      if (lines) { kind = "openapi"; body = lines.join("\n"); }
    } catch { /* not JSON: read it as text */ }
  } else if (/^\s*(openapi|swagger)\s*:/m.test(body.slice(0, 400))) {
    // a YAML OpenAPI document: the paths and their summaries, found line by line
    const out: string[] = [];
    let path = "";
    for (const line of body.split("\n")) {
      const p = /^ {2}(\/[^:\s]*):\s*$/.exec(line);
      if (p) { path = p[1]!; continue; }
      const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
      if (m && path) out.push(`${m[1]!.toUpperCase()} ${path}`);
      const s = /^ {6}summary:\s*(.+)$/.exec(line);
      if (s && out.length > 0 && !out[out.length - 1]!.includes(": ")) out[out.length - 1] += `: ${s[1]!.replace(/^['"]|['"]$/g, "")}`;
    }
    if (out.length > 0) { kind = "openapi"; body = out.join("\n"); }
  } else if (/<(html|body|head|div|p|h1)[\s>]/i.test(body.slice(0, 2000))) {
    kind = "html";
    links = linksOf(body, base);
    body = htmlText(body);
  }
  const picked = focus ? around(body, focus) : null;
  const text = picked ?? body;
  const truncated = text.length > MAX_TEXT;
  return { kind, text: truncated ? text.slice(0, MAX_TEXT) : text, links, truncated };
}
