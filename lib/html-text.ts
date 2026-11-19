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

/** The text cut to `max` characters, then back to its last ">" so a cut never leaves half a tag at the end. */
export function capHtml(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const gt = cut.lastIndexOf(">");
  return gt >= 0 ? cut.slice(0, gt + 1) : cut;
}

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
  const low = lc(html);
  const key = `<${lc(name)}`;
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
    const gt = scanTag(html, at).end;
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
  max = 4096,
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

/** The scan budget of one mail body: a tag attempt that fails costs what it read, and the body gets twice its own length. */
export interface MailScan {
  work: number;
  limit: number;
}
export const newMailScan = (html: string): MailScan => ({ work: 0, limit: html.length * 2 + 50_000 });

// HTML's own whitespace and nothing wider: a browser keeps NBSP, VT, U+FEFF and U+2028/9 inside a tag name or an unquoted value.
const isWs = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * Lowercase for ASCII letters only, so the result has the same length as the input and an index into it is an index into the original.
 * (toLowerCase turns "İ" into two code units; indices taken from it point past the text and let a <script> through.)
 */
export function lc(s: string): string {
  return /[A-Z]/.test(s) ? s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) : s;
}
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
  // no length cap on a tag (an inline data: image is hundreds of KB); the per-body budget bounds the failed attempts
  const stop = n;
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
 * stays as it is (the caller's tag stripper then takes it). `accept` can refuse an open tag by its (lowercased) text. Each name's missing close is
 * looked up once, so the time is linear however many open tags there are.
 */
export function cutBlocks(
  s: string,
  names: string[],
  opts: { comments?: boolean; repl?: string; accept?: (name: string, openTag: string) => boolean } = {},
): string {
  const low = lc(s);
  const noClose = new Set<string>();
  const closes = new Map<string, { start: number; end: number }>();
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
    // the first close after this open: a close found for an earlier open that is still ahead is the same one
    let c = closes.get(name);
    if (!c || c.start < p) {
      const e = closeTagEnd(low, name, p);
      if (e < 0) {
        noClose.add(name);
        continue;
      }
      c = { start: low.lastIndexOf("</", e), end: e };
      closes.set(name, c);
    }
    if (opts.accept && !opts.accept(name, low.slice(at, at + 600))) continue;
    const end = c.end;
    out += s.slice(i, at) + (opts.repl ?? "");
    i = from = end;
  }
  return i === 0 ? s : out + s.slice(i);
}

/** One attribute of a tag read by scanTag. `start` is the separator just before the name (a space or "/"), else the name's start. */
export interface TagAttr {
  start: number;
  name: string;
  /** index just past the value; equal to the name's end when there is no value */
  end: number;
  hasValue: boolean;
  /** the value's own text is s.slice(vs, ve) (inside the quotes when it has them) */
  vs: number;
  ve: number;
  quoted: boolean;
}
export interface TagScan {
  /** the ">" that ends the tag, or -1 when it never ends (an open quote runs to the end of the text, as a browser reads it) */
  end: number;
  attrs: TagAttr[];
}

/**
 * Reads the tag that opens at s[at] ("<" and a name) the way a browser does: a quote that starts a value ends only at its own
 * matching quote, so a ">" inside it does not end the tag; an unquoted value ends at whitespace or ">". One forward pass, so
 * linear in the tag's own length. A tag that never ends reports end -1 (and its attributes up to the end of the text).
 */
export function scanTag(s: string, at: number): TagScan {
  const n = s.length;
  const attrs: TagAttr[] = [];
  let p = at + 1;
  if (s.charCodeAt(p) === 47) p += 1;
  while (p < n && !isWs(s.charCodeAt(p)) && s.charCodeAt(p) !== 47 && s.charCodeAt(p) !== 62) p += 1;
  for (;;) {
    let sep = -1;
    while (p < n && (isWs(s.charCodeAt(p)) || s.charCodeAt(p) === 47)) {
      sep = p;
      p += 1;
    }
    if (p >= n) return { end: -1, attrs };
    if (s.charCodeAt(p) === 62) return { end: p, attrs };
    const ns = p;
    // a name may start with "=" (the browser keeps it); then it runs to whitespace, "/", "=" or ">"
    p += 1;
    while (p < n) {
      const c = s.charCodeAt(p);
      if (isWs(c) || c === 47 || c === 61 || c === 62) break;
      p += 1;
    }
    const name = s.slice(ns, p);
    let q = p;
    while (q < n && isWs(s.charCodeAt(q))) q += 1;
    let hasValue = false;
    let end = p;
    let vs = p;
    let ve = p;
    let quoted = false;
    if (s.charCodeAt(q) === 61) {
      hasValue = true;
      q += 1;
      while (q < n && isWs(s.charCodeAt(q))) q += 1;
      const v = s.charCodeAt(q);
      if (v === 34 || v === 39) {
        const e = s.indexOf(String.fromCharCode(v), q + 1);
        if (e < 0) {
          attrs.push({
            start: sep >= 0 && sep === ns - 1 ? sep : ns,
            name,
            end: n,
            hasValue,
            vs: q + 1,
            ve: n,
            quoted: true,
          });
          return { end: -1, attrs };
        }
        vs = q + 1;
        ve = e;
        quoted = true;
        end = e + 1;
      } else {
        end = q;
        while (end < n && !isWs(s.charCodeAt(end)) && s.charCodeAt(end) !== 62) end += 1;
        vs = q;
        ve = end;
      }
      p = end;
    }
    attrs.push({ start: sep >= 0 && sep === ns - 1 ? sep : ns, name, end, hasValue, vs, ve, quoted });
  }
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
  const low = lc(s);
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
    const gt = scanTag(s, at).end;
    if (gt < 0) break;
    from = gt + 1; // what is inside this tag is attribute text, not another tag
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
  const low = lc(s);
  let out = "";
  let i = 0;
  let from = 0;
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
    const gt = scanTag(s, at).end;
    if (accept && !accept(low.slice(ns, p), s.slice(at, Math.min(gt < 0 ? s.length : gt + 1, at + 4096)))) {
      if (gt < 0) break;
      from = gt + 1;
      continue;
    }
    // a tag that never ends (an open quote) takes the rest of the text with it, as a browser would read it
    out += s.slice(i, at);
    i = from = gt < 0 ? s.length : gt + 1;
    if (gt < 0) break;
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

const RAW_TEXT = new Set(["style", "script", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);

/** The index just past the end of the raw-text element named `name` whose content starts at `from` (its close tag, or the end of the text). */
function rawTextEnd(low: string, name: string, from: number): number {
  let q = low.indexOf("</" + name, from);
  while (q >= 0) {
    const c = low.charCodeAt(q + 2 + name.length);
    if (isWs(c) || c === 47 || c === 62 || Number.isNaN(c)) {
      const gt = low.indexOf(">", q);
      return gt < 0 ? low.length : gt + 1;
    }
    q = low.indexOf("</" + name, q + 2);
  }
  return low.length;
}

type Edit = [start: number, end: number, replacement: string];

/** Edits to the tags of `s`: pick(attr) may give one edit per attribute; a tag that never ends is an edit to the end of the text. `browser` reads comments and raw-text elements as a browser does. */
function tagEdits(s: string, low: string, browser: boolean, pick: (a: TagAttr) => Edit | null): Edit[] {
  const n = s.length;
  const out: Edit[] = [];
  let from = 0;
  let e1 = -2;
  let e2 = -2;
  for (;;) {
    const at = s.indexOf("<", from);
    if (at < 0) break;
    const c1 = s.charCodeAt(at + 1);
    if (browser && c1 === 33) {
      // <!-- comment -->, otherwise a bogus comment up to the first ">"
      if (s.startsWith("<!--", at)) {
        let end: number;
        if (s.startsWith("<!-->", at)) end = at + 5;
        else if (s.startsWith("<!--->", at)) end = at + 6;
        else {
          // a comment ends at "-->" or "--!>"
          // each terminator is searched for once and reused until it is passed (-1 means there is none left): a run of comments was quadratic
          if (e1 !== -1 && e1 < at + 4) e1 = s.indexOf("-->", at + 4);
          if (e2 !== -1 && e2 < at + 4) e2 = s.indexOf("--!>", at + 4);
          end = e1 < 0 && e2 < 0 ? n : e1 < 0 ? e2 + 4 : e2 < 0 || e1 < e2 ? e1 + 3 : e2 + 4;
        }
        from = end;
        continue;
      }
      const g = s.indexOf(">", at + 2);
      from = g < 0 ? n : g + 1;
      continue;
    }
    if (browser && c1 === 63) {
      const g = s.indexOf(">", at + 2);
      from = g < 0 ? n : g + 1;
      continue;
    }
    if (!isNameStart(c1)) {
      from = at + 1;
      continue;
    }
    const tag = scanTag(s, at);
    for (const a of tag.attrs) {
      const e = pick(a);
      if (e) out.push(e);
    }
    if (tag.end < 0) {
      out.push([at, n, ""]); // a tag that never ends: dropped with everything after it, never kept with an open quote
      break;
    }
    from = tag.end + 1;
    if (browser) {
      let p = at + 1;
      while (p < n && !isWs(s.charCodeAt(p)) && s.charCodeAt(p) !== 47 && s.charCodeAt(p) !== 62) p += 1;
      const name = low.slice(at + 1, p);
      if (name === "plaintext") break;
      if (RAW_TEXT.has(name) && s.charCodeAt(tag.end - 1) !== 47) from = rawTextEnd(low, name, tag.end + 1);
    }
  }
  return out;
}

/**
 * Removes every on* attribute (with a value) from every tag, wherever it sits in the tag and whatever quotes come before it. Linear.
 * The text is read twice and the removals of both readings are joined: once as a browser does (comments and raw-text elements such as
 * style and textarea hold no tags), once with every "<" a tag opener (the way svg and mathml content, and a browser that runs scripts
 * inside noscript, read it). A tag that never ends is dropped with the rest of the text.
 */
export function stripEventAttrs(s: string): string {
  const pick = (a: TagAttr): Edit | null => (a.hasValue && /^on[a-z]+$/i.test(a.name) ? [a.start, a.end, ""] : null);
  return applyEdits(s, tagEdits(s, lc(s), true, pick), tagEdits(s, lc(s), false, pick));
}

/** The edits of both readings, in order, with overlapping ones dropped. */
function applyEdits(s: string, ...lists: Edit[][]): string {
  const edits = lists.flat().sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let i = 0;
  for (const [a, b, r] of edits) {
    if (b <= i) continue;
    out += s.slice(i, Math.max(a, i)) + r;
    i = b;
  }
  return out + s.slice(i);
}

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "background",
  "poster",
  "formaction",
  "xlink:href",
  "data",
  "codebase",
  "cite",
  "longdesc",
  "usemap",
  "profile",
]);
const NAMED_CHARS: Record<string, string> = {
  tab: "\t",
  newline: "\n",
  colon: ":",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  lpar: "(",
  rpar: ")",
  sol: "/",
  period: ".",
};

/**
 * A URL as a browser reads it before it looks at the scheme: character references decoded, ASCII tab, LF and CR removed from anywhere,
 * leading control characters and spaces removed. Lowercased for the scheme test.
 */
export function urlForScheme(v: string): string {
  const decoded = v.replace(
    /&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]{2,8}));?/gi,
    (m, hex?: string, dec?: string, name?: string) => {
      if (hex !== undefined || dec !== undefined) {
        const cp = hex !== undefined ? parseInt(hex, 16) : Number(dec);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      }
      return NAMED_CHARS[lc(name ?? "")] ?? m;
    },
  );
  // eslint-disable-next-line no-control-regex
  return lc(decoded.replace(/[\t\n\r\0]/g, "").replace(/^[\u0000-\u0020]+/, ""));
}

/** True for a URL a page must not carry: a script scheme, or an HTML document in a data: URL. */
export function isScriptUrl(v: string): boolean {
  const u = urlForScheme(v);
  return /^(?:javascript|vbscript|livescript|mocha):/.test(u) || /^data:\s*(?:text\/html|application\/xhtml)/.test(u);
}

/**
 * Replaces the value of every URL attribute (href, src, action, ...) that holds a script URL with "#", quoted or not, however the scheme
 * is spelled (tabs, newlines, control characters and character references inside it). Linear; read the way stripEventAttrs reads.
 */
export function neutralizeUrlAttrs(s: string): string {
  const pick = (a: TagAttr): Edit | null =>
    a.hasValue && URL_ATTRS.has(lc(a.name)) && isScriptUrl(s.slice(a.vs, a.ve))
      ? a.quoted
        ? [a.vs, a.ve, "#"]
        : [a.vs, a.ve, '"#"']
      : null;
  return applyEdits(s, tagEdits(s, lc(s), true, pick), tagEdits(s, lc(s), false, pick));
}
