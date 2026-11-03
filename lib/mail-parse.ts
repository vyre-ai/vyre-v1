// Mail bodies made readable: quoted history and signatures folded away, Gmail emoji reactions recognised, HTML sanitised without a DOM,
// part bodies decoded by their charset and transfer encoding, and previews that end at a word. Pure: no I/O, no clock.
//
// Why it exists (owner, 3 Nov): a contact's mail showed every reply's quoted history, every signature and disclaimer, a Gmail reaction as raw text
// ("❤️ Irfad Imtiaz reacted via Gmail <https://...>"), and bodies cut mid-word at 160 characters.
// DECISION: the open message is never shortened. Only a one-line preview is cut, and it stops at a word and ends in "…".
// DECISION: a forwarded message ("---------- Forwarded message ---------") is the content, so it is not folded; a reply's history is.

export interface Cleaned {
  /** What the sender wrote this time. */
  body: string;
  /** Quoted history: "On … wrote:", Outlook's From/Sent block or Original Message, a trailing "> " block. Empty when there is none. */
  quoted: string;
  /** Signature, mobile footer or legal notice. Empty when there is none. */
  signature: string;
}

const WROTE = /^>?\s*(On|Le|Am|El|Il|Op|Em)\s.{4,240}(wrote|a écrit|schrieb|escribió|ha scritto|schreef|escreveu)\s*:\s*$/i;
const WROTE_START = /^>?\s*(On|Le|Am|El|Il|Op|Em)\s/i;
const WROTE_END = /(wrote|a écrit|schrieb|escribió|ha scritto|schreef|escreveu)\s*:\s*$/i;
const ORIGINAL = /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Message d'origine|Mensaje original)\s*-{2,}\s*$/i;
const RULE = /^_{10,}\s*$/;
const FORWARD = /^(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Weitergeleitete Nachricht\s*-{2,})\s*$/i;
const HEADER_FROM = /^\*?(From|De|Von|Van|Da)\*?:\s*\S/i;
const HEADER_NEXT = /^\*?(Sent|Date|Envoyé|Gesendet|Enviado|Verzonden|Data|To|Subject|Objet|Betreff|Asunto)\*?:\s*/i;
const MOBILE = /^(Sent from my \S|Sent from Mail for Windows|Sent from Yahoo Mail|Sent from Outlook|Get Outlook for (iOS|Android)|Sent via )/i;
const NOTICE = /^(CONFIDENTIALITY NOTICE|CONFIDENTIAL(ITY)?:|DISCLAIMER|PRIVILEGED (AND|&) CONFIDENTIAL|This (e-?mail|message|communication) (and any attachments? )?(is|are|may|contains?)|The information (contained )?in this (e-?mail|message))/i;

const norm = (s: string): string => s.replace(/\r\n?/g, "\n");

/** Where the quoted history starts, as a line index, or -1. */
function quoteStart(lines: string[]): number {
  const at = (i: number): string => (lines[i] ?? "").trim();
  for (let i = 0; i < lines.length; i++) {
    const x = at(i);
    if (!x) continue;
    if (FORWARD.test(x)) return -1;   // what follows a forward marker is the content
    if (WROTE.test(x)) return i;
    // Gmail wraps a long attribution: "On Tue, Oct 20, 2026 at 4:12 PM Josh Cohen <" then "josh@example.com> wrote:"
    if (WROTE_START.test(x) && !WROTE_END.test(x)) {
      const two = `${x} ${at(i + 1)}`;
      if (WROTE_END.test(two) && two.length < 300) return i;
    }
    if (ORIGINAL.test(x)) return i;
    if (RULE.test(x) && HEADER_FROM.test(at(i + 1))) return i;
    if (HEADER_FROM.test(x) && [1, 2, 3].some((k) => HEADER_NEXT.test(at(i + k))) && i > 0) return i;
    if (x.startsWith(">") && lines.slice(i).every((l) => !l.trim() || l.trim().startsWith(">"))) return i;
  }
  return -1;
}

/** Where the signature starts in the body (quoted history already removed), as a line index, or -1. */
function signatureStart(lines: string[], sender?: string): number {
  const name = (sender ?? "").trim().toLowerCase();
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const x = raw.trim();
    const afterBlank = !(lines[i - 1] ?? "").trim();
    if (raw === "-- " || x === "--") return i;
    if (MOBILE.test(x)) return i;
    if (afterBlank && NOTICE.test(x)) return i;
    // A block that starts with the sender's full name and goes on (title, firm, phone) is a signature; the name alone is a sign-off and stays.
    if (name && name.includes(" ") && x.toLowerCase().replace(/,$/, "") === name && lines.length - i <= 16 && lines.slice(i + 1).some((l) => l.trim())) return i;
  }
  return -1;
}

const tidy = (lines: string[]): string => lines.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/** Split a plain-text body into what was written, the quoted history and the signature. Nothing is cut. */
export function cleanText(text: string, sender?: string): Cleaned {
  const lines = norm(text ?? "").split("\n");
  const q = quoteStart(lines);
  const top = q < 0 ? lines : lines.slice(0, q);
  const quoted = q < 0 ? "" : tidy(lines.slice(q));
  const s = signatureStart(top, sender);
  const body = tidy(s < 0 ? top : top.slice(0, s));
  const signature = s < 0 ? "" : tidy(top.slice(s));
  // A message that is only a signature or only a quote keeps its text as the body, so nothing disappears.
  if (!body) return { body: tidy(top) || quoted, quoted: tidy(top) ? quoted : "", signature: tidy(top) ? "" : signature };
  return { body, quoted, signature };
}

// ---- previews

/** A one-line preview of at most `max` characters that ends at a word, with "…" when cut. Never a broken word. */
export function previewOf(text: string, max = 160): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = Math.max(1, max - 1);
  const cut = flat.lastIndexOf(" ", room);
  const head = cut > room * 0.5 ? flat.slice(0, cut) : flat.slice(0, room);
  return `${head.replace(/[\s,.;:–—-]+$/u, "")}…`;
}

/** The preview a list row shows: the first words the sender wrote this time, past a greeting. */
export function previewOfMessage(m: { text?: string | null; html?: string | null; subject?: string }, sender?: string, max = 160): string {
  const source = m.text && m.text.trim() ? m.text : m.html ? htmlToText(m.html) : "";
  const body = cleanText(source, sender).body.replace(/^\s*(hi|hello|hey|dear)\b[^\n]{0,40}\n+/i, "");
  return previewOf(body || m.subject || "", max);
}

// ---- Gmail reactions

export const REACTION_TYPE = "text/vnd.google.email-reaction+json";
const REACTED = /^\s*(\S{1,16}?)\s+(.{1,120}?)\s+reacted via Gmail\b/u;

/**
 * A Gmail emoji reaction, or null. Gmail sends a reaction as an email with a text/vnd.google.email-reaction+json part ({"version":1,"emoji":"❤️"}) and a
 * text part "❤️ Name reacted via Gmail <link>". Sync passes the JSON part's emoji as the x-vyre-reaction header; older mail is known by its text.
 */
export function reactionOf(m: { text?: string | null; html?: string | null; headers?: Record<string, string> | null }): { emoji: string; name?: string } | null {
  const h = m.headers ?? {};
  const fromHeader = h["x-vyre-reaction"];
  const t = REACTED.exec(m.text ?? "") ?? REACTED.exec(m.html ? htmlToText(m.html) : "");
  if (fromHeader) return t?.[2] ? { emoji: fromHeader, name: t[2] } : { emoji: fromHeader };
  if (!t?.[1]) return null;
  return t[2] ? { emoji: t[1], name: t[2] } : { emoji: t[1] };
}

/** The emoji in a reaction JSON part, or null. */
export function reactionEmoji(json: string): string | null {
  try {
    const v = JSON.parse(json) as { emoji?: unknown };
    return typeof v.emoji === "string" && v.emoji.length > 0 && v.emoji.length <= 16 ? v.emoji : null;
  } catch {
    return null;
  }
}

// ---- part decoding

/** The charset named in a Content-Type value, lowercased, or undefined. */
export function charsetOf(contentType?: string | null): string | undefined {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  return m?.[1]?.toLowerCase();
}

function qpBytes(s: string): Uint8Array {
  const soft = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const c = soft[i] ?? "";
    const hex = soft.slice(i + 1, i + 3);
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
    const code = c.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else for (const b of Buffer.from(c, "utf8")) out.push(b);
  }
  return Uint8Array.from(out);
}

/** Bytes as text in the part's charset; an unknown charset reads as UTF-8 and bad bytes become U+FFFD rather than an error. */
export function decodeBytes(bytes: Uint8Array, charset?: string): string {
  const label = (charset ?? "utf-8").toLowerCase().replace(/^(us-ascii|ascii)$/, "utf-8");
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/**
 * One MIME part body as text. `data` is what the provider gave: Gmail's base64url (transfer encoding already removed), or the raw part with its
 * Content-Transfer-Encoding (base64, quoted-printable, 7bit, 8bit, binary). The charset comes from the part's Content-Type.
 */
export function decodePart(data: string, o: { encoding?: string | null; charset?: string | null; base64url?: boolean } = {}): string {
  const enc = (o.encoding ?? "").toLowerCase().trim();
  let bytes: Uint8Array;
  if (o.base64url) bytes = Buffer.from(data, "base64url");
  else if (enc === "base64") bytes = Buffer.from(data.replace(/\s+/g, ""), "base64");
  else if (enc === "quoted-printable") bytes = qpBytes(data);
  else bytes = Buffer.from(data, "latin1");
  return decodeBytes(bytes, o.charset ?? undefined);
}

// ---- HTML

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·", zwnj: "", zwj: "", shy: "" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (all, k: string) => {
    if (k[0] === "#") {
      const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    const v = NAMED[k.toLowerCase()];
    return v === undefined ? all : v;
  });
}

const escText = (s: string): string => s.replace(/&(?!(#x[0-9a-f]+|#\d+|[a-z]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Tok { kind: "text" | "open" | "close" | "comment"; name: string; attrs: Record<string, string>; text: string; self: boolean }
const TAG = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function tokens(html: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    if (m.index > last) out.push({ kind: "text", name: "", attrs: {}, text: html.slice(last, m.index), self: false });
    last = TAG.lastIndex;
    const name = (m[1] ?? "").toLowerCase();
    if (!name) { out.push({ kind: "comment", name: "", attrs: {}, text: "", self: false }); continue; }
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = 0;
    for (let a = ATTR.exec(m[2] ?? ""); a; a = ATTR.exec(m[2] ?? "")) {
      const k = (a[1] ?? "").toLowerCase();
      if (k && !(k in attrs)) attrs[k] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    }
    out.push({ kind: m[0][1] === "/" ? "close" : "open", name, attrs, text: "", self: m[3] === "/" });
  }
  if (last < html.length) out.push({ kind: "text", name: "", attrs: {}, text: html.slice(last), self: false });
  return out;
}

/** Elements whose content never shows. */
const DROP = new Set(["script", "style", "head", "title", "template", "noscript", "iframe", "object", "embed", "applet", "svg", "math", "select", "textarea", "button", "form", "frameset", "frame", "xml", "video", "audio", "canvas"]);
const VOID = new Set(["br", "hr", "img", "wbr", "input", "meta", "link", "base", "col", "area", "source", "track", "param"]);
const KEEP = new Set(["p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "img", "hr", "small", "sub", "sup"]);
const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "ul", "ol", "hr", "section", "article", "header", "footer"]);

const classes = (t: Tok): string[] => (t.attrs.class ?? "").toLowerCase().split(/\s+/).filter(Boolean);
const isQuoteEl = (t: Tok): boolean => classes(t).includes("gmail_quote") || classes(t).includes("yahoo_quoted") || (t.name === "blockquote" && (t.attrs.type ?? "").toLowerCase() === "cite") || t.attrs.id === "divRplyFwdMsg";
const isSigEl = (t: Tok): boolean => classes(t).includes("gmail_signature") || t.attrs["data-smartmail"] === "gmail_signature" || /^signature$/i.test(t.attrs.id ?? "") || classes(t).includes("moz-signature");
/** Outlook puts the reply header, then the whole history, after these as siblings, so everything from here on is quoted. */
const startsTail = (t: Tok): boolean => t.attrs.id === "divRplyFwdMsg" || t.attrs.id === "appendonsend" || t.attrs.id === "mail-editor-reference-message-container";

/** The text of an HTML body: blocks and breaks become line breaks, list items get "- ", nothing that never shows (scripts, styles). */
export function htmlToText(html: string): string {
  let out = "";
  let drop = 0;
  // a block boundary is one line break however many tags meet there; <br> is always one; a paragraph ends with a blank line
  const soft = (): void => { if (out && !out.endsWith("\n")) out += "\n"; };
  for (const t of tokens(html ?? "")) {
    if (t.kind === "comment") continue;
    if (DROP.has(t.name)) { if (t.kind === "open" && !t.self && !VOID.has(t.name)) drop++; else if (t.kind === "close") drop = Math.max(0, drop - 1); continue; }
    if (drop) continue;
    if (t.kind === "text") { const x = decodeEntities(t.text.replace(/\s+/g, " ")); if (x.trim() || !out.endsWith("\n")) out += x; }
    else if (t.name === "br") out = out.replace(/[ \t]+$/, "") + "\n";
    else if (t.name === "li" && t.kind === "open") { soft(); out += "- "; }
    else if (t.name === "td" && t.kind === "close") out += " ";
    else if (t.name === "p" && t.kind === "close") { soft(); if (!out.endsWith("\n\n")) out += "\n"; }
    else if (BLOCK.has(t.name)) soft();
  }
  return out.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

export interface SafeHtml {
  /** Sanitised HTML: allowlisted tags, href and src only, links open safely and show where they go. */
  html: string;
  /** The same content as text. */
  text: string;
  quoted: string;
  signature: string;
  /** Remote images held back until the person allows them. */
  imagesHeld: number;
  /** One-pixel tracking images dropped. */
  pixels: number;
}

function hostOf(href: string): string {
  if (/^mailto:/i.test(href)) return href.slice(7).split("?")[0] ?? "";
  try { return new URL(href).host; } catch { return ""; }
}

function safeHref(raw: string): string | null {
  // control characters and spaces inside a scheme are an old trick ("java\nscript:"); decode, strip them, then allow only web and mail links
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]+/g, "").trim();
  return /^(https?:|mailto:)/i.test(v) ? v : null;
}

/**
 * HTML mail made safe to show. No scripts, styles, forms, frames or event handlers; no attributes but a link's href and an image's src and alt; links get
 * target=_blank, rel=noopener noreferrer nofollow and, when the text does not say it, the host they go to. Remote images are held unless `images` is true;
 * one-pixel trackers are always dropped; only data:image (png, gif, jpeg, webp) and cid: images show otherwise. Gmail and Outlook quote blocks and
 * signature blocks come out as text in `quoted` and `signature`.
 */
export function sanitizeHtml(html: string, o: { images?: boolean } = {}): SafeHtml {
  const toks = tokens(html ?? "");
  let out = "";
  const stack: string[] = [];
  let drop = 0;
  let cap: { kind: "quoted" | "signature"; depth: number; buf: string } | null = null;
  let tail = false;
  let tailBuf = "";
  const quoted: string[] = [];
  const signature: string[] = [];
  let imagesHeld = 0, pixels = 0;
  const link: { host: string; text: string }[] = [];

  const emit = (s: string): void => {
    if (tail) tailBuf += s;
    else if (cap) cap.buf += s;
    else out += s;
  };

  for (const t of toks) {
    if (t.kind === "comment") continue;
    if (DROP.has(t.name)) { if (t.kind === "open" && !t.self && !VOID.has(t.name)) drop++; else if (t.kind === "close") drop = Math.max(0, drop - 1); continue; }
    if (drop) continue;
    if (t.kind === "open" && !tail && startsTail(t)) tail = true;
    if (t.kind === "open" && !tail && !cap && (isQuoteEl(t) || isSigEl(t)) && !VOID.has(t.name)) {
      cap = { kind: isQuoteEl(t) ? "quoted" : "signature", depth: 0, buf: "" };
    }
    if (cap && t.kind === "open" && !VOID.has(t.name) && !t.self) cap.depth++;
    if (cap && t.kind === "close") {
      cap.depth--;
      if (cap.depth <= 0) {
        cap.buf += `</${t.name}>`;
        (cap.kind === "quoted" ? quoted : signature).push(htmlToText(cap.buf));
        cap = null;
        continue;
      }
    }
    if (cap || tail) { emit(t.kind === "text" ? t.text : t.kind === "open" ? `<${t.name}>` : `</${t.name}>`); continue; }

    if (t.kind === "text") {
      out += escText(t.text);
      for (const l of link) l.text += decodeEntities(t.text);
      continue;
    }
    if (!KEEP.has(t.name)) continue;   // unknown element: its tags go, its text stays
    if (t.kind === "open") {
      if (t.name === "img") {
        const src = (t.attrs.src ?? "").trim();
        if (t.attrs.width === "1" || t.attrs.height === "1" || /^(0|1)px$/i.test(t.attrs.width ?? "")) { pixels++; continue; }
        const alt = t.attrs.alt ? ` alt="${escAttr(t.attrs.alt)}"` : "";
        if (/^https?:/i.test(src)) {
          if (!o.images) { imagesHeld++; continue; }
          out += `<img src="${escAttr(src)}"${alt}>`;
        } else if (/^data:image\/(png|gif|jpeg|webp);/i.test(src) || /^cid:/i.test(src)) out += `<img src="${escAttr(src)}"${alt}>`;
        continue;
      }
      if (VOID.has(t.name)) { out += `<${t.name}>`; continue; }
      if (t.name === "a") {
        const href = safeHref(t.attrs.href ?? "");
        out += href ? `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">` : "<a>";
        link.push({ host: href ? hostOf(href) : "", text: "" });
      } else out += `<${t.name}>`;
      stack.push(t.name);
      continue;
    }
    // close: only what is open, innermost first, so the output is always balanced
    const at = stack.lastIndexOf(t.name);
    if (at < 0) continue;
    while (stack.length > at) {
      const name = stack.pop() ?? "";
      out += `</${name}>`;
      if (name === "a") {
        const l = link.pop();
        if (l?.host && !l.text.toLowerCase().includes(l.host.toLowerCase())) out += ` <span class="vy-link-host">(${escText(l.host)})</span>`;
      }
    }
  }
  if (cap) (cap.kind === "quoted" ? quoted : signature).push(htmlToText(cap.buf));
  while (stack.length) out += `</${stack.pop() ?? ""}>`;
  if (tailBuf) quoted.push(htmlToText(tailBuf));
  const clean = out.replace(/(<br>\s*){3,}/g, "<br><br>").trim();
  return {
    html: clean,
    text: htmlToText(clean.replace(/<span class="vy-link-host">[^<]*<\/span>/g, "")),
    quoted: quoted.filter(Boolean).join("\n\n"),
    signature: signature.filter(Boolean).join("\n\n"),
    imagesHeld,
    pixels,
  };
}

/** A message's readable parts, from its text, else its HTML. The sender's display name helps find the signature. */
export function cleanMessage(m: { text?: string | null; html?: string | null }, sender?: string, o: { images?: boolean } = {}): Cleaned & { html?: string; imagesHeld?: number } {
  if (m.html && m.html.trim()) {
    const h = sanitizeHtml(m.html, o);
    // the HTML's own quote and signature blocks, then the text rules on what is left (an HTML reply may still carry "On … wrote:" as plain lines)
    const t = cleanText(h.text, sender);
    const out: Cleaned & { html?: string; imagesHeld?: number } = {
      body: t.body,
      quoted: [h.quoted, t.quoted].filter(Boolean).join("\n\n"),
      signature: [h.signature, t.signature].filter(Boolean).join("\n\n"),
      html: h.html,
    };
    if (h.imagesHeld) out.imagesHeld = h.imagesHeld;
    if (!m.text || !m.text.trim()) return out;
    // both parts: the text part decides body, quote and signature; the HTML is kept for rendering
    const tt = cleanText(m.text, sender);
    return { ...out, body: tt.body, quoted: tt.quoted || out.quoted, signature: tt.signature || out.signature };
  }
  return cleanText(m.text ?? "", sender);
}
