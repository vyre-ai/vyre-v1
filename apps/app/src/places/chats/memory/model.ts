// Memory inside a chat, the pure part: what a reply used (facts and exact quotes), the words that go with it, the underline of known subjects in message text (a name or an alias of a page,
// found without regex lookbehind and never inside code or a link), and the small rules the learned line, the right-click items and the Knows tab share. No React and no clock.
import type { Block, Inline } from "../../../../../../ui/src/stream/markdown.ts";
import { dateText } from "../../files/memory/know.ts";

export type Layer = "space" | "project" | "agent" | "person";
export type SourceKind = "chat" | "channel" | "record" | "run" | "journey" | "task" | "note" | "manual";

/** One fact as a chat shows it: what memory.used and memory.knows return per fact (the extras are optional, a row without them draws as plain text). */
export interface ChatFact {
  factId: string;
  text: string;
  layer: Layer;
  sourceKind: SourceKind;
  sourceRef: string;
  sourceLink?: string;
  sourceTitle?: string;
  subject?: { pageId: string; title: string; kind: string };
  /** When it was learned. */
  at: number;
  status?: string;
  by?: string;
  byKind?: "person" | "agent" | "upkeep";
  agentId?: string;
  /** The upkeep question this fact waits on ("Two answers, waiting for a pick"). */
  conflict?: boolean;
}

export interface ChatQuote {
  ref: string;
  text: string;
  author: { kind: "person" | "agent"; id: string; name: string };
  at: number;
  threadId: string;
  threadTitle: string;
  link: string;
}

/** memory.used {threadId, messageId}: what one reply recalled. */
export interface UsedOut { facts: ChatFact[]; quotes: ChatQuote[] }
/** memory.knows {threadId, agentId?, asOf?}: the facts in scope for this chat and this asker. */
export interface KnowsOut { facts: ChatFact[] }

export const usedCount = (u: UsedOut | undefined): number => (u ? u.facts.length + u.quotes.length : 0);
export const usedLabel = (n: number): string => `Used ${n} ${n === 1 ? "memory" : "memories"}`;
export const USED_FOOT = "Only what you could open yourself is ever recalled. A quote card means the words were recalled exactly.";

/** "Oct 12" for a quote's date, "Today" for the same day. */
export const quoteDate = dateText;

/** The words of a fact row in the list under a reply: "Ian Brooks: Prefers updates on Fridays." */
export const factLine = (f: ChatFact): string => (f.subject ? `${f.subject.title}: ${f.text}` : f.text);

/** The one line a quote card shows under its author: "Oct 12 · Brooks kickoff". */
export const quoteSub = (q: ChatQuote, now: number): string => `${quoteDate(q.at, now)} · ${q.threadTitle}`;

// ---------------------------------------------------------------- the underline of known subjects

/** A page as the underline needs it: its title and the other names it answers to. */
export interface SubjectPage { pageId: string; title: string; kind: string; alias?: string[] }
export interface SubjectIndex { names: ReadonlyArray<readonly [string, string]>; re: RegExp | null }
export const NO_SUBJECTS: SubjectIndex = { names: [], re: null };
export const SUBJECT_KINDS: ReadonlySet<string> = new Set(["person", "client", "project", "topic"]);
export const SUBJECT_HREF = "vyre-subject:";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every title and alias of a page of a known kind, three letters or more, longest first (so "Ian Brooks" wins over "Ian"). */
export function subjectIndex(pages: readonly SubjectPage[]): SubjectIndex {
  const seen = new Map<string, readonly [string, string]>();
  for (const p of pages) {
    if (!SUBJECT_KINDS.has(p.kind)) continue;
    for (const n of [p.title, ...(p.alias ?? [])]) {
      const name = n.trim();
      if (name.length >= 3 && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), [name, p.pageId]);
    }
  }
  const ordered = [...seen.values()].sort((a, b) => b[0].length - a[0].length);
  if (ordered.length === 0) return NO_SUBJECTS;
  // The character before must not be a word, a path or an address character; the one after must not continue a word or an address. The before-character is matched, not looked behind.
  // Names match as written (a name is a capital letter); "will" is not a person because a Will has a page.
  const re = new RegExp(`(^|[^\\w/@.\\-])(${ordered.map(([n]) => esc(n)).join("|")})(?![\\w@\\-])`, "g");
  return { names: ordered, re };
}

export type Seg = { t: "text"; v: string } | { t: "subject"; v: string; pageId: string };

/** A text cut into plain runs and known subjects, in order. A text with none is one plain run. */
export function splitSubjects(text: string, idx: SubjectIndex): Seg[] {
  if (!idx.re || text === "") return [{ t: "text", v: text }];
  const byName = new Map(idx.names.map(([n, id]) => [n, id] as const));
  const out: Seg[] = [];
  let at = 0;
  const re = new RegExp(idx.re.source, idx.re.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lead = m[1] ?? "", name = m[2] ?? "";
    const start = m.index + lead.length;
    const pageId = byName.get(name);
    if (!pageId) continue;
    if (start > at) out.push({ t: "text", v: text.slice(at, start) });
    out.push({ t: "subject", v: name, pageId });
    at = start + name.length;
    re.lastIndex = at;
  }
  if (at < text.length) out.push({ t: "text", v: text.slice(at) });
  return out.length > 0 ? out : [{ t: "text", v: text }];
}

export const hasSubject = (segs: readonly Seg[]): boolean => segs.some((s) => s.t === "subject");

const subjectsIn = (items: readonly Inline[], idx: SubjectIndex): Inline[] => {
  const out: Inline[] = [];
  for (const n of items) {
    if (n.t === "text") {
      for (const s of splitSubjects(n.v, idx)) out.push(s.t === "subject" ? { t: "link", href: SUBJECT_HREF + s.pageId, c: [{ t: "text", v: s.v }] } : { t: "text", v: s.v });
    } else if (n.t === "strong" || n.t === "em") out.push({ ...n, c: subjectsIn(n.c, idx) });
    else out.push(n); // code and links stay as they are
  }
  return out;
};

/** The blocks of a message with known subjects turned into links of their own kind (href `vyre-subject:<pageId>`). Code blocks, inline code and links are left alone; blocks without a subject keep their object. */
export function linkSubjects(blocks: readonly Block[], idx: SubjectIndex): Block[] {
  if (!idx.re) return [...blocks];
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === "p" || b.kind === "h" || b.kind === "quote") {
      const inline = subjectsIn(b.inline, idx);
      out.push(JSON.stringify(inline) === JSON.stringify(b.inline) ? b : { ...b, inline });
    } else if (b.kind === "ul" || b.kind === "ol") {
      const items = b.items.map((it) => subjectsIn(it, idx));
      out.push(JSON.stringify(items) === JSON.stringify(b.items) ? b : { ...b, items });
    } else out.push(b);
  }
  return out;
}

/** What a key does on an underlined subject: Enter or Space opens its page, Escape closes its card. */
export function subjectKey(key: string): "open" | "close" | null {
  return key === "Enter" || key === " " ? "open" : key === "Escape" ? "close" : null;
}

/** What a key does on a fact row of the Knows tab (focus on the row itself): Enter or e edits it. */
export function knowRowKey(key: string): "edit" | null {
  return key === "Enter" || key === "e" ? "edit" : null;
}

export const subjectOfHref = (href: string): string | null => (href.startsWith(SUBJECT_HREF) ? href.slice(SUBJECT_HREF.length) : null);

// ---------------------------------------------------------------- the learned line

export interface LearnedRow { factId: string; text: string; subjectTitle?: string; pageId?: string; sourceRef: string; at: number }

/** The text of a message for "Remember this": its words, markup left in, trimmed and cut at 400 letters. */
export function rememberText(body: string): string {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > 400 ? `${t.slice(0, 399)}…` : t;
}

/** The line a Remember, Forget or Add flashes. */
export const FLASH = {
  remembered: "Remembered.",
  rememberedFor: (project: string): string => `Remembered for ${project}.`,
  proposedTo: (project: string): string => `Proposed to ${project}. It waits for a yes.`,
  noneToForget: "Nothing was learned from this message, so there is nothing to forget.",
  forgot: (n: number): string => `Forgot ${n} ${n === 1 ? "fact" : "facts"} learned from this message. It is in Trash for 60 days.`,
  added: (title: string): string => `Added to ${title}.`,
} as const;

/** Appends a line to the end of a page's Notes, on a line of its own. */
export function appendLine(notes: string, line: string): string {
  const body = notes.replace(/\s+$/, "");
  return body === "" ? line : `${body}\n${line}`;
}

// ---------------------------------------------------------------- the Knows tab

export const LAYER_ORDER: readonly Layer[] = ["space", "project", "agent", "person"];
export const LAYER_HEAD: Record<Layer, string> = { space: "Space", project: "Project", agent: "Agent", person: "You" };

export interface KnowsGroup { layer: Layer; head: string; facts: ChatFact[] }

/** The facts cut into Space, Project, Agent and You, newest first inside a group; an empty group is left out. */
export function groupKnows(facts: readonly ChatFact[]): KnowsGroup[] {
  const out: KnowsGroup[] = [];
  for (const layer of LAYER_ORDER) {
    const list = facts.filter((f) => f.layer === layer).sort((a, b) => b.at - a.at);
    if (list.length > 0) out.push({ layer, head: LAYER_HEAD[layer], facts: list });
  }
  return out;
}

/** What Knows shows when it is pinned to one reply: the facts that were true by then (a fact learned later is hidden). */
export const asOfFilter = (facts: readonly ChatFact[], asOf: number | null): ChatFact[] => (asOf === null ? [...facts] : facts.filter((f) => f.at <= asOf));

export const KNOWS_SCOPE = "In this chat and what it links to. Never more than you could open yourself.";
export const KNOWS_FOOT = "Edit any line and the old wording is kept in history.";

const STOP = new Set(["that", "this", "with", "from", "have", "your", "will", "what", "when", "they", "them", "there", "their", "about", "which", "would", "could", "should", "into", "than", "then", "also", "been", "were", "does", "just", "like", "some", "more", "most", "very", "here", "only"]);
const wordsOf = (s: string): string[] => (s.toLowerCase().match(/[a-z\u00c0-\u024f0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/**
 * Did this memory shape the reply? Recall hands the model whatever matches the message a little, so most replies "used" something that had nothing to do with what was said. A fact counts only when the
 * reply itself carries its substance: at least two of its significant words, or half of them for a short fact.
 */
export function shapedReply(fact: string, reply: string): boolean {
  const f = [...new Set(wordsOf(fact))];
  if (f.length === 0) return false;
  const r = new Set(wordsOf(reply));
  const hit = f.filter((w) => r.has(w)).length;
  return hit >= 2 || (f.length <= 3 && hit >= Math.ceil(f.length / 2) && hit >= 1);
}
