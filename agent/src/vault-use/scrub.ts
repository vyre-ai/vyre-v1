// Output scrubbing (ARCH 6.11): a value that was filled into a process never reaches the model. We remove the exact value and its common encodings
// (base64 at every alignment, base64url, url-encoded, form-encoded, hex, JSON-escaped), then look for what is left: any long fragment of a value in the result means a
// miss. A miss is reported (the value itself never is) and the whole output is withheld.
export const MIN_SECRET_LENGTH = 4;
const FRAGMENT = 8;
/** Characters carried between stream pieces when looking for a leftover fragment. */
export const FRAGMENT_TAIL = FRAGMENT - 1;
const FRAGMENT_MIN_SECRET = 12;
export const WITHHELD = "[output withheld: it may contain a secret]";

export interface Secret { handle: string; itemId: string; value: string }
export interface MissReport { itemId: string; handle: string }

function b64Variants(raw: Uint8Array): string[] {
  const out: string[] = [];
  // The value encoded on its own, whole: padded or not, standard or url-safe.
  const whole = Buffer.from(raw).toString("base64");
  for (const w of [whole, whole.replace(/=+$/, "")]) out.push(w, w.replace(/\+/g, "-").replace(/\//g, "_"));
  for (const k of [0, 1, 2]) {
    const padded = new Uint8Array(k + raw.length);
    padded.set(raw, k);
    let enc = Buffer.from(padded).toString("base64").replace(/=+$/, "");
    // Characters that depend on bytes outside the value are not part of the value's own encoding.
    enc = enc.slice([0, 2, 3][k] ?? 0, (k + raw.length) % 3 === 0 ? undefined : -1);
    if (enc.length >= 6) out.push(enc, enc.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return out;
}

/** Every spelling of `value` we remove. */
export function variantsOf(value: string): string[] {
  const raw = new TextEncoder().encode(value);
  const set = new Set<string>([value]);
  const json = JSON.stringify(value).slice(1, -1);
  set.add(json);
  const url = encodeURIComponent(value);
  set.add(url);
  set.add(url.replace(/%20/g, "+"));
  set.add(url.toLowerCase());
  const hex = Buffer.from(raw).toString("hex");
  set.add(hex);
  set.add(hex.toUpperCase());
  for (const v of b64Variants(raw)) set.add(v);
  return [...set].filter((v) => v.length >= (v === value ? MIN_SECRET_LENGTH : 6));
}

export interface Scrubber {
  /** Longest spelling we look for. */
  readonly span: number;
  scrub(text: string): string;
  /** Scrub a stream without letting a value hide across a chunk boundary. */
  stream(source: AsyncIterable<string>): AsyncIterable<string>;
  /** Fragments of a value still present after scrubbing. */
  residual(text: string): Secret[];
}

export function createScrubber(secrets: readonly Secret[]): Scrubber {
  const label = new Map<string, string>();
  for (const s of secrets) {
    if (s.value.length < MIN_SECRET_LENGTH) throw new RangeError("a value too short to scrub is never filled");
    for (const v of variantsOf(s.value)) if (!label.has(v)) label.set(v, s.handle);
  }
  const spelled = [...label.keys()].sort((a, b) => b.length - a.length);
  const span = spelled[0]?.length ?? 0;
  const mark = (h: string): string => `[${h}]`;

  /** Every occurrence of every spelling (overlapping ones included), merged into disjoint regions, so a short spelling inside a longer one cannot break the longer one. */
  const spans = (text: string): Array<[number, number, string]> => {
    const all: Array<[number, number, string]> = [];
    for (const v of spelled) {
      const h = label.get(v) ?? "";
      for (let at = text.indexOf(v); at >= 0; at = text.indexOf(v, at + 1)) all.push([at, at + v.length, h]);
    }
    all.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    const merged: Array<[number, number, string]> = [];
    for (const m of all) {
      const last = merged[merged.length - 1];
      if (last && m[0] < last[1]) { if (m[1] > last[1]) last[1] = m[1]; } else merged.push([m[0], m[1], m[2]]);
    }
    return merged;
  };
  const scrub = (text: string): string => {
    let out = "", at = 0;
    for (const [a, b, h] of spans(text)) { out += text.slice(at, a) + mark(h); at = b; }
    return out + text.slice(at);
  };

  const windows = secrets.filter((s) => s.value.length >= FRAGMENT_MIN_SECRET).map((s) => {
    const w: string[] = [];
    for (const v of variantsOf(s.value)) if (v.length >= FRAGMENT_MIN_SECRET) for (let i = 0; i + FRAGMENT <= v.length; i++) w.push(v.slice(i, i + FRAGMENT));
    return { s, w: [...new Set(w)] };
  });

  return {
    span,
    scrub,
    async *stream(source) {
      let carry = "";
      for await (const chunk of source) {
        const text = carry + chunk;
        let cut = Math.max(0, text.length - Math.max(0, span - 1));
        for (const [a, b] of spans(text)) if (a < cut && cut < b) cut = a;
        if (cut > 0) yield scrub(text.slice(0, cut));
        carry = text.slice(cut);
      }
      if (carry) yield scrub(carry);
    },
    residual(text) {
      const hit: Secret[] = [];
      for (const { s, w } of windows) if (w.some((x) => text.includes(x))) hit.push(s);
      return hit;
    },
  };
}
