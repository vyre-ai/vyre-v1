// Merge tokens in email text: {{field}} or {{field|fallback}}. One reader for the template module and anything else that fills a subject or a body.
// A token with a value gets the value; with none it gets its fallback (an empty fallback, {{field|}}, means "leave it out"); with neither it is BLANK:
// the text shows the field's name in plain words and the caller is told, so a preview can say which fields would send empty.
const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const humanize = (key: string): string => key.replace(/_/g, " ");

export interface Filled {
  text: string;
  /** Fields that had neither a value nor a fallback. */
  blanks: string[];
  /** Fields that used their fallback. */
  fallbacks: string[];
}

/** Fill the tokens of `source`. `html` escapes the values (a link or a name can carry < or &). Keys are lower case. */
export function fillTokens(source: string, values: Record<string, string>, opts: { html?: boolean } = {}): Filled {
  const blanks = new Set<string>();
  const fallbacks = new Set<string>();
  const text = source.replace(TOKEN, (_m, raw: string, fb: string | undefined) => {
    const key = raw.toLowerCase();
    const value = values[key];
    let out: string;
    if (value !== undefined && value !== "") out = value;
    else if (fb !== undefined) {
      fallbacks.add(key);
      out = fb.trim();
    } else {
      blanks.add(key);
      out = humanize(key);
    }
    return opts.html ? escape(out) : out;
  });
  return { text, blanks: [...blanks], fallbacks: [...fallbacks] };
}

/** Every field a text names, in order of first appearance. */
export function tokensIn(source: string): { key: string; fallback?: string }[] {
  const seen = new Map<string, { key: string; fallback?: string }>();
  for (const m of source.matchAll(TOKEN)) {
    const key = (m[1] ?? "").toLowerCase();
    if (!seen.has(key)) seen.set(key, m[2] !== undefined ? { key, fallback: m[2].trim() } : { key });
  }
  return [...seen.values()];
}
