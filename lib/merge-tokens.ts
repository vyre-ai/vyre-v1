// Merge tokens in email text: {{field}} or {{field|fallback}}. One reader for the template module and anything else that fills a subject or a body.
// A token with a value gets the value; with none it gets its fallback (an empty fallback, {{field|}}, means "leave it out"); with neither it is BLANK:
// the text shows the field's name in plain words and the caller is told, so a preview can say which fields would send empty.
//
// The scan is one pass with indexOf: no regular expression, so no input can make it slow. A field name is at most 64 letters, digits or underscores;
// a fallback is at most 200 characters and stops at the first "}". Anything that does not fit stays as plain text. Values are looked up by their own
// names only, so {{constructor}} or {{__proto__}} are blank like any unknown field.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const humanize = (key: string): string => key.replace(/_/g, " ");
const MAX_KEY = 64;
const MAX_FALLBACK = 200;

export interface Filled {
  text: string;
  /** Fields that had neither a value nor a fallback. */
  blanks: string[];
  /** Fields that used their fallback. */
  fallbacks: string[];
}

interface Piece {
  /** Text to copy, or a token. */
  literal?: string;
  key?: string;
  fallback?: string;
}

const isKeyStart = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isKeyChar = (c: number): boolean => isKeyStart(c) || (c >= 48 && c <= 57) || c === 95;

/** Split a text into plain pieces and tokens in one pass. */
function scan(source: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  let from = 0;
  while (true) {
    const open = source.indexOf("{{", from);
    if (open < 0) break;
    let i = open + 2;
    while (i < source.length && (source.charCodeAt(i) === 32 || source.charCodeAt(i) === 9)) i++;
    const start = i;
    if (i < source.length && isKeyStart(source.charCodeAt(i))) {
      while (i < source.length && i - start <= MAX_KEY && isKeyChar(source.charCodeAt(i))) i++;
      const key = source.slice(start, i);
      while (i < source.length && (source.charCodeAt(i) === 32 || source.charCodeAt(i) === 9)) i++;
      let fallback: string | undefined;
      let end = -1;
      if (key.length <= MAX_KEY && source.startsWith("}}", i)) end = i + 2;
      else if (key.length <= MAX_KEY && source.charCodeAt(i) === 124) {
        // look for the closing brace only inside the fallback's own size, so a long run of unfinished tokens costs a fixed amount each
        let close = i + 1;
        const limit = Math.min(source.length, i + 1 + MAX_FALLBACK + 1);
        while (close < limit && source.charCodeAt(close) !== 125) close++;
        if (close < limit && source.startsWith("}}", close)) {
          fallback = source.slice(i + 1, close);
          end = close + 2;
        }
      }
      if (end > 0) {
        if (open > at) out.push({ literal: source.slice(at, open) });
        out.push(fallback === undefined ? { key: key.toLowerCase() } : { key: key.toLowerCase(), fallback });
        at = end;
        from = end;
        continue;
      }
    }
    from = open + 2; // not a token: carry on after the braces
  }
  if (at < source.length) out.push({ literal: source.slice(at) });
  return out;
}

/** Fill the tokens of `source`. `html` escapes the values (a link or a name can carry < or &). */
export function fillTokens(source: string, values: Record<string, string>, opts: { html?: boolean } = {}): Filled {
  const blanks = new Set<string>();
  const fallbacks = new Set<string>();
  let text = "";
  for (const p of scan(source)) {
    if (p.literal !== undefined) {
      text += p.literal;
      continue;
    }
    const key = p.key as string;
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    let out: string;
    if (value !== undefined && value !== "") out = value;
    else if (p.fallback !== undefined) {
      fallbacks.add(key);
      out = p.fallback.trim();
    } else {
      blanks.add(key);
      out = humanize(key);
    }
    text += opts.html ? escape(out) : out;
  }
  return { text, blanks: [...blanks], fallbacks: [...fallbacks] };
}

/** Every field a text names, in order of first appearance. */
export function tokensIn(source: string): { key: string; fallback?: string }[] {
  const seen = new Map<string, { key: string; fallback?: string }>();
  for (const p of scan(source)) {
    if (p.key === undefined || seen.has(p.key)) continue;
    seen.set(p.key, p.fallback !== undefined ? { key: p.key, fallback: p.fallback.trim() } : { key: p.key });
  }
  return [...seen.values()];
}
