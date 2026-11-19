// Linear text helpers for untrusted HTML and text (rc.40). A regex with two quantifiers that can take the same characters
// ("<[^>]+>" run over "<<<<", "\s+on..." over a long space run) backtracks in quadratic time: 100 KB of hostile input froze a
// worker for seconds. These helpers use indexOf and one pass, so the time is linear in the input and has a hard cap.
// No node imports: the browser app uses them too.

/** The longest mail body, fetched page or chat body any regex runs over. */
export const MAX_MAIL_HTML = 200_000;
/** The longest single address part in a From/To/Cc header (RFC 5322 line limit). */
export const MAX_ADDRESS_PART = 998;

/** The text cut to `max` characters (default 200 KB) before a regex touches it. */
export const capText = (s: string, max = MAX_MAIL_HTML): string => (s.length > max ? s.slice(0, max) : s);

/** Replaces every `<...>` (up to the next ">") with `repl`. A "<" with no ">" after it stays as text. Linear. */
export function stripTags(html: string, repl = ""): string {
  let out = "";
  let i = 0;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break;
    out += html.slice(i, lt) + repl;
    i = gt + 1;
  }
  return i === 0 ? html : out + html.slice(i);
}

/** The whole `<name ...>` opening tags of one element name (case-insensitive), each up to its next ">". Linear; `max` cuts a runaway tag. */
export function tagsNamed(html: string, name: string, max = 4096): string[] {
  const out: string[] = [];
  const low = html.toLowerCase();
  const key = `<${name.toLowerCase()}`;
  let i = 0;
  for (;;) {
    const at = low.indexOf(key, i);
    if (at < 0) break;
    const after = low.charCodeAt(at + key.length);
    // a word boundary: "<meta " and "<meta>" but not "<metadata"
    if (after >= 97 && after <= 122) {
      i = at + key.length;
      continue;
    }
    const gt = html.indexOf(">", at);
    if (gt < 0) break;
    if (gt - at <= max) out.push(html.slice(at, gt + 1));
    i = gt + 1;
  }
  return out;
}

/** True for a Markdown table rule row ("| --- | :---: |"). Linear; replaces a regex whose adjacent \s* groups backtracked. */
export function isPipeRule(line: string): boolean {
  if (line.length > 10_000) return false;
  let t = line.trim();
  if (!t) return false;
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  if (!t.trim()) return false;
  for (const cell of t.split("|")) {
    let c = cell.trim();
    if (c.startsWith(":")) c = c.slice(1);
    if (c.endsWith(":")) c = c.slice(0, -1);
    if (c.length < 3) return false;
    for (let k = 0; k < c.length; k += 1) if (c.charCodeAt(k) !== 45) return false;
  }
  return true;
}

/** True for a Markdown table row ("| a | b |"): trimmed, it starts and ends with a pipe and has two. */
export function isPipeRow(line: string): boolean {
  if (line.length > 10_000) return false;
  const t = line.trim();
  return t.length >= 2 && t.startsWith("|") && t.endsWith("|");
}

/**
 * Replaces each `{{key}}` or `{{key|fallback}}` (key `[a-z][a-z0-9_]*`, case-insensitive; spaces allowed inside the braces).
 * One pass with indexOf; a token longer than `max` or with no closing braces is left as text. Linear.
 */
export function replaceTokens(
  s: string,
  fn: (key: string, fallback: string | undefined, whole: string) => string,
  max = 512,
): string {
  let out = "";
  let i = 0;
  let from = 0;
  let close = -2;
  for (;;) {
    const open = s.indexOf("{{", from);
    if (open < 0) break;
    // the next "}}" is found once and reused until it is passed, so a long run of "{{" is not rescanned
    if (close !== -1 && close < open + 2) close = s.indexOf("}}", open + 2);
    if (close < 0) break;
    const m = close - open <= max ? TOKEN_BODY.exec(s.slice(open + 2, close)) : null;
    if (!m) {
      from = open + 1;
      continue;
    }
    out += s.slice(i, open) + fn(m[1]!, m[2], s.slice(open, close + 2));
    i = close + 2;
    from = i;
  }
  return i === 0 ? s : out + s.slice(i);
}
const TOKEN_BODY = /^\s*([a-z][a-z0-9_]*)\s*(?:\|([^}]*))?$/i;

/** One markup item found by mailTagAt. `name` is empty for a comment, declaration or processing instruction. */
export interface MailTag {
  /** index just past the item */
  end: number;
  name: string;
  /** the raw attribute text of a tag */
  attrs: string;
  self: boolean;
  close: boolean;
}

/** The scan budget of one mail body: a tag attempt that fails costs what it read, and the body gets a few times its own length. */
export interface MailScan {
  work: number;
  limit: number;
}
export const newMailScan = (html: string): MailScan => ({ work: 0, limit: html.length * 4 + 100_000 });

const MAIL_TAG_MAX = 16_384;
const isWs = (c: number): boolean =>
  c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0xfeff || c === 0x2028 || c === 0x2029;
const isNameStart = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number): boolean => isNameStart(c) || (c >= 48 && c <= 57) || c === 58 || c === 45;
// an attribute name: anything but whitespace and " ' > / =
const isAttrChar = (c: number): boolean => !isWs(c) && c !== 34 && c !== 39 && c !== 62 && c !== 47 && c !== 61;

/**
 * Reads the markup item that starts at html[i] ("<"), or null when it is not one (the "<" is then text).
 * The same items the old regex matched (comments, CDATA, "<!...>", "<?...>", open and close tags with attributes),
 * read in one forward pass with a length cap and a per-body budget, so no input takes more than linear time.
 */
export function mailTagAt(html: string, i: number, scan: MailScan): MailTag | null {
  if (scan.work > scan.limit) return null;
  const n = html.length;
  const stop = Math.min(n, i + MAIL_TAG_MAX);
  const fail = (at: number): null => {
    scan.work += Math.max(1, at - i);
    return null;
  };
  const c1 = html.charCodeAt(i + 1);
  const bare = (end: number): MailTag => ({ end, name: "", attrs: "", self: false, close: false });
  if (c1 === 33) {
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      return bare(e < 0 ? n : e + 3);
    }
    if (html.startsWith("<![CDATA[", i)) {
      const e = html.indexOf("]]>", i + 9);
      if (e >= 0) return bare(e + 3);
    }
    const g = html.indexOf(">", i + 2);
    return g < 0 ? fail(n) : bare(g + 1);
  }
  if (c1 === 63) {
    const g = html.indexOf(">", i + 2);
    return g < 0 ? fail(n) : bare(g + 1);
  }
  let p = i + 1;
  const close = c1 === 47;
  if (close) p += 1;
  if (!isNameStart(html.charCodeAt(p))) return fail(p);
  const nameAt = p;
  while (p < stop && isNameChar(html.charCodeAt(p))) p += 1;
  const name = html.slice(nameAt, p);
  const attrsFrom = p;
  let attrsTo = p;
  for (;;) {
    let q = p;
    while (q < stop && isWs(html.charCodeAt(q))) q += 1;
    if (q === p) break; // an attribute needs whitespace before it
    const nameStart = q;
    while (q < stop && isAttrChar(html.charCodeAt(q))) q += 1;
    if (q === nameStart) break;
    let r = q;
    while (r < stop && isWs(html.charCodeAt(r))) r += 1;
    if (html.charCodeAt(r) === 61) {
      r += 1;
      while (r < stop && isWs(html.charCodeAt(r))) r += 1;
      const v = html.charCodeAt(r);
      if (v === 34 || v === 39) {
        const e = html.indexOf(v === 34 ? '"' : "'", r + 1);
        if (e < 0 || e >= stop) return fail(stop);
        q = e + 1;
      } else {
        const vs = r;
        while (
          r < stop &&
          !isWs(html.charCodeAt(r)) &&
          html.charCodeAt(r) !== 34 &&
          html.charCodeAt(r) !== 39 &&
          html.charCodeAt(r) !== 62
        )
          r += 1;
        if (r === vs) return fail(r);
        q = r;
      }
    }
    p = q;
    attrsTo = p;
  }
  while (p < stop && isWs(html.charCodeAt(p))) p += 1;
  let self = false;
  if (html.charCodeAt(p) === 47) {
    self = true;
    p += 1;
  }
  if (html.charCodeAt(p) !== 62 || p >= stop) return fail(p);
  return { end: p + 1, name, attrs: html.slice(attrsFrom, attrsTo), self, close };
}

/** The index just past the first `</name ... >` at or after `from` in `low` (already lowercased), or -1. Linear in what it reads. */
export function closeTagEnd(low: string, name: string, from: number): number {
  let q = low.indexOf("</", from);
  while (q >= 0) {
    let p = q + 2;
    while (isWs(low.charCodeAt(p))) p += 1;
    if (low.startsWith(name, p)) {
      p += name.length;
      while (isWs(low.charCodeAt(p))) p += 1;
      if (low.charCodeAt(p) === 62) return p + 1;
    }
    q = low.indexOf("</", q + 2);
  }
  return -1;
}

/**
 * Removes whole `<name ...> ... </name>` blocks and (with `comments`) `<!-- ... -->`. An open tag with no closing tag anywhere after it
 * stays as it is (the caller's tag stripper then takes it). `accept` can refuse an open tag by its text. Each name's missing close is
 * looked up once, so the time is linear however many open tags there are.
 */
export function cutBlocks(
  s: string,
  names: string[],
  opts: { comments?: boolean; repl?: string; accept?: (name: string, openTag: string) => boolean } = {},
): string {
  const low = s.toLowerCase();
  const noClose = new Set<string>();
  let out = "";
  let i = 0;
  let from = 0;
  for (;;) {
    const at = low.indexOf("<", from);
    if (at < 0) break;
    from = at + 1;
    if (opts.comments && low.startsWith("<!--", at)) {
      if (noClose.has("--")) continue;
      const e = low.indexOf("-->", at + 4);
      if (e < 0) {
        noClose.add("--");
        continue;
      }
      out += s.slice(i, at) + (opts.repl ?? "");
      i = from = e + 3;
      continue;
    }
    let p = at + 1;
    while (isWs(low.charCodeAt(p))) p += 1;
    const ns = p;
    while (isNameStart(low.charCodeAt(p))) p += 1;
    const name = low.slice(ns, p);
    if (!names.includes(name) || noClose.has(name)) continue;
    if (opts.accept && !opts.accept(name, s.slice(at, at + 4096))) continue;
    const end = closeTagEnd(low, name, p);
    if (end < 0) {
      noClose.add(name);
      continue;
    }
    out += s.slice(i, at) + (opts.repl ?? "");
    i = from = end;
  }
  return i === 0 ? s : out + s.slice(i);
}

/**
 * Replaces each `<a ...> label </a>` whose opening tag `accept` takes with fn(tagText, label); an anchor with no closing tag
 * after it stays. The next close is remembered between anchors, so a run of unclosed anchors is read once. Linear.
 */
export function replaceAnchors(
  s: string,
  accept: (openTag: string) => boolean,
  fn: (openTag: string, label: string) => string,
): string {
  const low = s.toLowerCase();
  let out = "";
  let i = 0;
  let from = 0;
  let closeAt = -1; // start of the cached "</a>"
  let closeEnd = -1;
  for (;;) {
    const at = low.indexOf("<a", from);
    if (at < 0) break;
    from = at + 2;
    const b = low.charCodeAt(at + 2);
    if (isNameChar(b) && b !== 45 && b !== 58) continue;
    const gt = s.indexOf(">", at);
    if (gt < 0) break;
    if (gt - at > 4096) continue;
    const tag = s.slice(at, gt + 1);
    if (!accept(tag)) continue;
    if (closeAt < gt + 1) {
      closeEnd = closeTagEnd(low, "a", gt + 1);
      if (closeEnd < 0) break;
      closeAt = low.lastIndexOf("</", closeEnd);
    }
    out += s.slice(i, at) + fn(tag, s.slice(gt + 1, closeAt));
    i = from = closeEnd;
  }
  return i === 0 ? s : out + s.slice(i);
}

/** An open tag of one of `names` ("<input ...>"), removed up to its next ">". `accept` can refuse one by its text. Each missing ">" is looked up once. Linear. */
export function cutTags(s: string, names: string[], accept?: (name: string, tag: string) => boolean): string {
  const low = s.toLowerCase();
  let out = "";
  let i = 0;
  let from = 0;
  let gt = -2;
  for (;;) {
    const at = low.indexOf("<", from);
    if (at < 0) break;
    from = at + 1;
    let p = at + 1;
    while (isWs(low.charCodeAt(p))) p += 1;
    const ns = p;
    while (isNameStart(low.charCodeAt(p))) p += 1;
    if (!names.includes(low.slice(ns, p))) continue;
    if (isNameChar(low.charCodeAt(p))) continue; // "<inputs", "<form-x": another name
    if (gt !== -1 && gt < p) gt = low.indexOf(">", p);
    if (gt < 0) break;
    if (accept && !accept(low.slice(ns, p), s.slice(at, Math.min(gt + 1, at + 4096)))) continue;
    out += s.slice(i, at);
    i = from = gt + 1;
  }
  return i === 0 ? s : out + s.slice(i);
}

/** One Markdown `[text](url "title")` or `![alt](url)` found by mdLinks. */
export interface MdLink {
  start: number;
  end: number;
  image: boolean;
  text: string;
  /** everything between the parentheses */
  body: string;
  /** the address: the body up to its first whitespace */
  url: string;
}

/**
 * The Markdown links and images in `s`, in order and not overlapping. The text holds no "]" or line break and is at most 500 long;
 * the part in parentheses is at most 2500 long. Found by walking the "](" marks with a remembered next ")", so the time is linear.
 */
export function mdLinks(s: string): MdLink[] {
  const out: MdLink[] = [];
  let from = 0;
  let paren = -2;
  let last = 0;
  for (;;) {
    const k = s.indexOf("](", from);
    if (k < 0) break;
    from = k + 2;
    let b = k - 1;
    const lo = Math.max(0, k - 501);
    while (b >= lo) {
      const c = s.charCodeAt(b);
      if (c === 91 || c === 93 || c === 10) break;
      b -= 1;
    }
    if (b < lo || s.charCodeAt(b) !== 91 || b < last) continue;
    if (paren !== -1 && paren < from) paren = s.indexOf(")", from);
    if (paren < 0) break;
    if (paren - from > 2500) continue;
    const image = b > last && s.charCodeAt(b - 1) === 33;
    const body = s.slice(from, paren);
    const url = /^\S*/.exec(body)![0];
    out.push({ start: image ? b - 1 : b, end: paren + 1, image, text: s.slice(b + 1, k), body, url });
    last = paren + 1;
    from = last;
  }
  return out;
}

/** `s` with each Markdown link or image replaced by fn(link). */
export function replaceMdLinks(s: string, fn: (m: MdLink) => string): string {
  let out = "";
  let i = 0;
  for (const m of mdLinks(s)) {
    out += s.slice(i, m.start) + fn(m);
    i = m.end;
  }
  return i === 0 ? s : out + s.slice(i);
}
