// Tracked changes as plain text: CriticMarkup, the form an agent writes a suggestion in and the form the file keeps.
//   {++added++}   {--removed--}   {~~old~>new~~}   each may be followed by {>>author|time<<}
// These functions work on the Markdown text with no editor, so a Flow, the fill engine or an agent can read, count and resolve a document's suggestions the same way a person's Accept all does.
// Fenced code is left alone: a page that explains CriticMarkup keeps its examples.

export interface CriticChange {
  kind: "add" | "del" | "sub";
  /** What was removed (del, sub) and what was added (add, sub). */
  old: string;
  added: string;
  author: string;
  at: string;
  /** Where the markup starts and ends in the text. */
  from: number;
  to: number;
}

// The markup is read by scanning for its closing marker with indexOf, never with a pattern that can backtrack: a document is shared text, and a hostile one ("{~~a~>" repeated) must cost a pass, not a freeze.
// Each search remembers its last answer: the text between two searches for the same marker holds none, so asking again from a later start costs nothing.
// A change never reaches past a blank line (the editor reads one paragraph at a time, and the text readers must agree with it).
let seenSrc = "";
const seen = new Map<string, { from: number; at: number }>();
function cached(src: string, key: string, from: number, search: () => number): number {
  if (seenSrc !== src) {
    seenSrc = src;
    seen.clear();
  }
  const c = seen.get(key);
  if (c && from >= c.from && (c.at === -1 || from <= c.at)) return c.at;
  const at = search();
  seen.set(key, { from, at });
  return at;
}
const BLANK = /\n[ \t]*\n/g;
/** The end of the paragraph that holds `from`: where the next blank line starts, or the end of the text. */
function paragraphEnd(src: string, from: number): number {
  const at = cached(src, "\n\n", from, () => {
    BLANK.lastIndex = from;
    const m = BLANK.exec(src);
    return m ? m.index : -1;
  });
  return at < 0 ? src.length : at;
}
/** The marker at or after `from`, when it is inside the paragraph; otherwise -1. */
function find(src: string, closer: string, from: number): number {
  const at = cached(src, closer, from, () => src.indexOf(closer, from));
  return at >= 0 && at < paragraphEnd(src, from) ? at : -1;
}
const WHO = /^([^|<>{}\n]*)\|([^<>{}\n]*)$/;
/** The `{>>author|time<<}` after a change, when there is one right at `p`. */
function metaAt(src: string, p: number): { author: string; at: string; end: number } | null {
  if (!src.startsWith("{>>", p)) return null;
  const close = find(src, "<<}", p + 3);
  if (close < 0 || close - p > 400) return null;
  const m = WHO.exec(src.slice(p + 3, close));
  return m ? { author: m[1] ?? "", at: m[2] ?? "", end: close + 3 } : null;
}

/** The change that starts exactly at `i` in `src`, or null. */
export function criticAt(src: string, i: number): CriticChange | null {
  const kind = src.startsWith("{++", i)
    ? "add"
    : src.startsWith("{--", i)
      ? "del"
      : src.startsWith("{~~", i)
        ? "sub"
        : null;
  if (kind === null) return null;
  const open = i + 3;
  let old = "";
  let added = "";
  let end: number;
  if (kind === "sub") {
    const arrow = find(src, "~>", open);
    if (arrow <= open) return null;
    const close = find(src, "~~}", arrow + 2);
    if (close < 0) return null;
    old = src.slice(open, arrow);
    added = src.slice(arrow + 2, close);
    end = close + 3;
  } else {
    const closer = kind === "add" ? "++}" : "--}";
    const close = find(src, closer, open);
    if (close <= open) return null;
    if (kind === "add") added = src.slice(open, close);
    else old = src.slice(open, close);
    end = close + 3;
  }
  const who = metaAt(src, end);
  return { kind, old, added, author: who?.author ?? "", at: who?.at ?? "", from: i, to: who?.end ?? end };
}

/** The parts of a text outside fenced code, as [from, to) offsets. */
function openRanges(md: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  let fence: string | null = null;
  let at = 0;
  for (const line of md.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    const lineEnd = at + line.length + 1;
    if (f) {
      const mark = (f[1] as string).charAt(0);
      if (fence === null) {
        out.push([start, at]);
        fence = mark;
      } else if (fence === mark) {
        fence = null;
        start = lineEnd;
      }
    }
    at = lineEnd;
  }
  if (fence === null) out.push([start, md.length]);
  return out.filter(([a, b]) => b > a);
}

/** Every tracked change in a text, in order. */
export function listCritic(md: string): CriticChange[] {
  const out: CriticChange[] = [];
  for (const [a, b] of openRanges(md)) {
    // each stretch outside fenced code is read as a text of its own, so a closer beyond the fence is never searched for
    const part = md.slice(a, b);
    let i = part.indexOf("{");
    while (i >= 0) {
      const c = criticAt(part, i);
      if (c) {
        out.push({ ...c, from: c.from + a, to: c.to + a });
        i = part.indexOf("{", c.to);
      } else i = part.indexOf("{", i + 1);
    }
  }
  return out;
}

/** How many suggestions wait in a text. */
export const countCritic = (md: string): number => listCritic(md).length;

const settled = (c: CriticChange, accept: boolean): string =>
  c.kind === "sub" ? (accept ? c.added : c.old) : c.kind === "add" ? (accept ? c.added : "") : accept ? "" : c.old;

/** The text with every suggestion accepted (the change is made) or rejected (the text stays as it was). */
export function resolveCritic(md: string, accept: boolean): string {
  let out = "";
  let at = 0;
  for (const c of listCritic(md)) {
    out += md.slice(at, c.from) + settled(c, accept);
    at = c.to;
  }
  return out + md.slice(at);
}

/** One suggestion resolved, by its position in `listCritic` (the others stay). */
export function resolveOneCritic(md: string, index: number, accept: boolean): string {
  const c = listCritic(md)[index];
  if (!c) return md;
  const text =
    c.kind === "sub" ? (accept ? c.added : c.old) : c.kind === "add" ? (accept ? c.added : "") : accept ? "" : c.old;
  return md.slice(0, c.from) + text + md.slice(c.to);
}

/** Who made suggestions in a text, once each, in order. */
export function criticAuthors(md: string): string[] {
  const seen = new Set<string>();
  for (const c of listCritic(md)) if (c.author !== "") seen.add(c.author);
  return [...seen];
}

/** A suggestion written the way the editor writes it. `author` loses the characters the markup cannot carry. */
export function writeCritic(c: {
  kind: "add" | "del" | "sub";
  old?: string;
  added?: string;
  author: string;
  at: string;
}): string {
  const who = `{>>${cleanAuthor(c.author)}|${c.at}<<}`;
  if (c.kind === "add") return `{++${c.added ?? ""}++}${who}`;
  if (c.kind === "del") return `{--${c.old ?? ""}--}${who}`;
  return `{~~${c.old ?? ""}~>${c.added ?? ""}~~}${who}`;
}

export const cleanAuthor = (a: string): string =>
  a
    .replace(/[|<>{}\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
