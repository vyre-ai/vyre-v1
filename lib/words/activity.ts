// The one place an activity line becomes words for a person. A feed line is stored as a plain sentence that may carry two tokens: {at:<ms>} (a moment) and {who:<id>} (a person or agent).
// The reader fills them in: times in their zone, once; names from their directory; "you" for themself. Old lines with no token read as they were stored.
import { shortTime } from "./time.ts";

export interface Viewer {
  /** the reader's id */
  me: string;
  /** a name for any id: a person by name, a Space agent by its name, someone else's private agent as "<Person> (Agent)" (the directory already answers so) */
  nameOf(id: string): string;
  /** the reader's zone against UTC, in minutes */
  offsetMin: number;
}
export interface ActivityEvent { kind?: string; text: string; /** the sentence with tokens, when the server sent both */ tpl?: string | undefined; by?: string | undefined; at: number; ref?: string | undefined }
export interface ActivityLine { text: string; credit: string; at: number; ref?: string | undefined }

const TOKEN = /\{(at|who):([^}]+)\}/g;
const cap = (s: string): string => (s === "" ? s : s[0]!.toUpperCase() + s.slice(1));

/** Fills the tokens of a sentence for this reader. "you" at the start of a sentence reads "You". */
export function expandWords(text: string, v: Viewer): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    out += text.slice(last, i);
    const val = m[1] === "at" ? shortTime(Number(m[2]), v.offsetMin) : m[2] === v.me ? "you" : v.nameOf(m[2]!);
    const start = out === "" || /[.!?]\s*$/.test(out);
    out += start ? cap(val) : val;
    last = i + m[0].length;
  }
  return out + text.slice(last);
}

/** Who did it, as the reader says it. Stored as "<actor>" or "<agent>><person it acted for>". The reader's directory decides what an agent is called: a Space agent by its name ("Dex"), the reader's own agent by its name, someone else's private agent as its person ("Omar Reyes (Agent)"). */
export function creditOf(by: string | undefined, v: Viewer): string {
  if (!by) return "";
  const actor = by.split(">")[0] ?? by;
  if (actor.startsWith("svc_")) return "Vyre";
  return actor === v.me ? "You" : v.nameOf(actor);
}

export function formatActivity(e: ActivityEvent, v: Viewer): ActivityLine {
  const line: ActivityLine = { text: expandWords(e.tpl ?? e.text, v), credit: creditOf(e.by, v), at: e.at };
  if (e.ref !== undefined) line.ref = e.ref;
  return line;
}

/** The ids a stored sentence names, so a server can look their names up before it fills the tokens in. */
export function whoIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(TOKEN)) if (m[1] === "who") ids.add(m[2]!);
  return [...ids];
}
