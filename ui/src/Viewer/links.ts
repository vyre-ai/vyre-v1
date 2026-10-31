// File references inside a note's words (rc.8): [[Name]], [text](relative/path.md) and a bare file name like VYRE.md or agent.toml. This finds them; what they point at is looked up by the caller (the Files
// place) and handed back as `targets`, so a name that is a real file reachable from this one becomes a link, and a wikilink to nothing becomes a dim broken link that can create the file.

export interface FileLinkTarget { id: string; name: string; path?: string }

export interface FileLinks {
  /** ref -> where it points. null: nothing there (a broken link). A ref not in the map has not been looked up, or is not a file. */
  targets: ReadonlyMap<string, FileLinkTarget | null>;
  /** Open the file in a tab of its own; `background` keeps the person where they are (Cmd-click, middle click). */
  open(target: FileLinkTarget, background: boolean): void;
  /** Make the missing file (an empty one beside this file) and open it. Left out where files cannot be made. */
  create?(ref: string): void;
}

export interface FileRef {
  /** Where it sits in the text: [start, end). */
  start: number;
  end: number;
  /** What the person sees. */
  label: string;
  /** What is looked up: the name or path as written. */
  ref: string;
  kind: "wiki" | "md" | "bare";
}

const EXT = "md|markdown|toml|txt|json|ya?ml|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|ts|tsx|js|jsx|py|sh|html|css";
// one alternation, leftmost first: a wikilink, a markdown link to a path (not a web address), or a bare file name
const RE = new RegExp(`\\[\\[([^\\]\\n]+)\\]\\]|\\[([^\\]\\n]+)\\]\\((?!https?:|mailto:|#|/\\/)([^)\\s]+)\\)|(?<![\\w/.@-])([\\w][\\w.-]*\\.(?:${EXT}))(?![\\w-])`, "gi");

/** Every file reference in the text, in order. */
export function refsIn(text: string): FileRef[] {
  const out: FileRef[] = [];
  for (const m of text.matchAll(RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (m[1] !== undefined) out.push({ start, end, label: m[1].trim(), ref: m[1].trim(), kind: "wiki" });
    else if (m[3] !== undefined) out.push({ start, end, label: m[2] ?? m[3], ref: decodeURI(m[3]).replace(/#.*$/, "").replace(/^\.\//, ""), kind: "md" });
    else if (m[4] !== undefined) out.push({ start, end, label: m[4], ref: m[4], kind: "bare" });
  }
  return out;
}

/** The text cut at its references: plain strings and references, in order. */
export function splitRefs(text: string): Array<string | FileRef> {
  const out: Array<string | FileRef> = [];
  let at = 0;
  for (const r of refsIn(text)) {
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(r);
    at = r.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The refs a document asks about: each distinct one once. */
export function distinctRefs(text: string): FileRef[] {
  const seen = new Set<string>();
  const out: FileRef[] = [];
  for (const r of refsIn(text)) if (!seen.has(r.ref)) { seen.add(r.ref); out.push(r); }
  return out;
}

/** What a reference shows as: a link to a file, a broken link, or just words (a bare name that is not a file here, or a ref not looked up yet). */
export function linkState(r: FileRef, links: FileLinks | undefined): "link" | "broken" | "plain" {
  const t = links?.targets.get(r.ref);
  if (t) return "link";
  if (t === null && r.kind !== "bare") return "broken";
  return "plain";
}
