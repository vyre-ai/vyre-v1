// Tracked changes as plain text: CriticMarkup, the form an agent writes a suggestion in and the form the file keeps.
//   {++added++}   {--removed--}   {~~old~>new~~}   each may be followed by {>>author|time<<}
// These functions work on the Markdown text with no editor, so a Flow, the fill engine or an agent can read, count and resolve a document's suggestions the same way a person's Accept all does.
// Fenced code is left alone: a page that explains CriticMarkup keeps its examples.

const META = String.raw`(?:\{>>([^|<>{}\n]*)\|([^<>{}\n]*)<<\})?`;
const ADD = () => new RegExp(String.raw`\{\+\+([\s\S]+?)\+\+\}` + META, "g");
const DEL = () => new RegExp(String.raw`\{--([\s\S]+?)--\}` + META, "g");
const SUB = () => new RegExp(String.raw`\{~~([\s\S]+?)~>([\s\S]*?)~~\}` + META, "g");

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
    const part = md.slice(a, b);
    const found: CriticChange[] = [];
    // a replacement first, so its halves are not read as a removal and an addition
    for (const m of part.matchAll(SUB()))
      found.push({
        kind: "sub",
        old: m[1] ?? "",
        added: m[2] ?? "",
        author: m[3] ?? "",
        at: m[4] ?? "",
        from: a + (m.index ?? 0),
        to: a + (m.index ?? 0) + m[0].length,
      });
    for (const m of part.matchAll(ADD()))
      found.push({
        kind: "add",
        old: "",
        added: m[1] ?? "",
        author: m[2] ?? "",
        at: m[3] ?? "",
        from: a + (m.index ?? 0),
        to: a + (m.index ?? 0) + m[0].length,
      });
    for (const m of part.matchAll(DEL()))
      found.push({
        kind: "del",
        old: m[1] ?? "",
        added: "",
        author: m[2] ?? "",
        at: m[3] ?? "",
        from: a + (m.index ?? 0),
        to: a + (m.index ?? 0) + m[0].length,
      });
    out.push(...found);
  }
  return out.sort((x, y) => x.from - y.from);
}

/** How many suggestions wait in a text. */
export const countCritic = (md: string): number => listCritic(md).length;

/** The text with every suggestion accepted (the change is made) or rejected (the text stays as it was). */
export function resolveCritic(md: string, accept: boolean): string {
  const ranges = openRanges(md);
  let out = "";
  let at = 0;
  for (const [a, b] of ranges) {
    out += md.slice(at, a);
    out += md
      .slice(a, b)
      .replace(SUB(), (_m, o: string, n: string) => (accept ? n : o))
      .replace(ADD(), (_m, t: string) => (accept ? t : ""))
      .replace(DEL(), (_m, t: string) => (accept ? "" : t));
    at = b;
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
