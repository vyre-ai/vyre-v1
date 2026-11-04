// Memory lives where it was learned (MEMORY-RULES 1, 3, 5, 9). A place is a chat, channel, project, task, goal or record; a thread maps to the place it hangs under, and a task points up to its
// project or goal. This file names the place of a chat, holds the kinds and states, and finds the subject two statements share, so a newer one can replace an older one and a clash can become a question.
import { chatAudience, placeAudienceText } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";
import { rowsOf } from "./projections.ts";
import type { Db, Fact, MemCtx } from "./projections.ts";

export const PLACE_KINDS = ["chat", "channel", "project", "task", "goal", "record"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export interface Place { kind: PlaceKind; id: string; /** the place it points up to: a task's project or goal, a project chat's project */ parent?: { kind: PlaceKind; id: string } }

/** Kinds of a shared-place memory (rule 3). Anything else a model proposes is kept as a fact. */
export const MEMORY_KINDS = ["decision", "fact", "commitment", "preference", "question", "role"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
/** The kind a captured line is filed under: the old names map across (deadline is a commitment, note and profile are facts). */
export function kindOf(raw: string | null | undefined): MemoryKind {
  const k = (raw ?? "").toLowerCase();
  if ((MEMORY_KINDS as readonly string[]).includes(k)) return k as MemoryKind;
  if (k === "deadline" || k === "owes") return "commitment";
  if (k === "open question" || k === "open_question") return "question";
  return "fact";
}

type Obj = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The place a chat's memory belongs to: threads climb to their parent; a chat in a project, task or goal belongs to that; a channel to its channel; any other chat to itself. */
export async function placeOf(ctx: Pick<MemCtx, "call">, threadId: string): Promise<Place> {
  let id = threadId;
  for (let i = 0; i < 8; i++) {
    let t: Obj | undefined;
    try { t = ((await ctx.call("threads.get", { threadId: id })) as { thread?: Obj }).thread; } catch { return { kind: "chat", id: threadId }; }
    if (!t) return { kind: "chat", id: threadId };
    const parent = text(t["parentThreadId"]);
    if (parent !== "" && text(t["channelId"]) === "") { id = parent; continue; }
    const st = text(t["scopeType"]), sid = text(t["scopeId"]);
    if (sid !== "" && (st === "project" || st === "task" || st === "goal" || st === "record")) {
      return { kind: st, id: sid, ...(st === "task" ? await taskParent(ctx, sid) : {}) };
    }
    if (text(t["channelId"]) !== "") return { kind: "channel", id: text(t["channelId"]) };
    return { kind: "chat", id };
  }
  return { kind: "chat", id: threadId };
}

async function taskParent(ctx: Pick<MemCtx, "call">, taskId: string): Promise<{ parent?: { kind: PlaceKind; id: string } }> {
  try {
    const task = ((await ctx.call("tasks.get", { taskId })) as { task?: Obj }).task ?? {};
    const goal = text(task["goalId"]), project = text(task["projectId"]);
    if (goal !== "") return { parent: { kind: "goal", id: goal } };
    if (project !== "") return { parent: { kind: "project", id: project } };
  } catch { /* a task that cannot be read has no known parent */ }
  return {};
}

/** The audience a shared-place fact is stored with: it names its chat and is read against whoever may open that chat now, never as open to the Space. */
export const placeAudienceOf = (a: Audience, threadId: string): string => placeAudienceText(a, threadId);

/** The people a place has now, for the "Noted" line and the Knows tab. */
export async function peopleIn(ctx: Pick<MemCtx, "call">, threadId: string): Promise<Audience> { return chatAudience((cap, i) => ctx.call(cap, i), threadId); }

// ---- subject: which statements are about the same thing

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "is", "are", "was", "were", "be", "we", "i", "you", "it", "our", "will", "going", "go", "decided", "agreed", "chose",
  "settled", "use", "that", "this", "now", "so", "then", "have", "has", "had", "do", "does", "did", "not", "no", "yes", "instead", "again", "final", "actually", "update", "changed", "change", "switch", "switched"]);
const stem = (w: string): string => w.replace(/(ing|ed|es|s)$/, "");

/** The words a statement is about: its content words with the verbs of deciding and the small words dropped. */
export function subjectWords(t: string): Set<string> {
  return new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
}

/** Do two statements say something about the same subject? At least two shared content words and three fifths of the shorter one's: "the Atlas launch is March fifth" and "the Atlas launch announcement is at noon" share a name, not a subject. */
export function sameSubject(a: string, b: string): boolean {
  const x = subjectWords(a), y = subjectWords(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared >= Math.min(2, x.size, y.size) && shared / Math.min(x.size, y.size) >= 0.6;
}

/** Do two statements about one subject disagree? Same subject and a different value (a number, date, name or option not in the other). */
export function disagree(a: string, b: string): boolean {
  if (!sameSubject(a, b)) return false;
  const x = subjectWords(a), y = subjectWords(b);
  for (const w of x) if (!y.has(w)) return true;
  for (const w of y) if (!x.has(w)) return true;
  return false;
}

// ---- states

/** What a fact is in the eyes of a reader: current, replaced (a later fact replaced it), disputed (an open question names it) or source removed (its message was deleted). */
export function stateOf(db: Db, f: Pick<Fact, "id" | "status" | "state">): "current" | "replaced" | "disputed" | "source_removed" {
  if (f.state === "source_removed") return "source_removed";
  if (f.state === "disputed") return "disputed";
  if (f.status === "closed" && rowsOf(db, "SELECT 1 FROM memory_facts WHERE replaces = ? LIMIT 1", f.id)[0]) return "replaced";
  return "current";
}

/** The words that differ between two statements about one thing ("Thursday" against "Friday"), capitalised: the short answer a question offers. */
export function diffValue(a: string, b: string): string {
  const tok = (x: string): string[] => x.replace(/[.,;:!?"]/g, "").split(/\s+/).filter((w) => w !== "");
  const other = new Set(tok(b).map((w) => w.toLowerCase()));
  const d = tok(a).filter((w) => !other.has(w.toLowerCase())).join(" ");
  const v = d !== "" ? d : a.replace(/\s+/g, " ").trim().slice(0, 40);
  return `${v.charAt(0).toUpperCase()}${v.slice(1)}`;
}
