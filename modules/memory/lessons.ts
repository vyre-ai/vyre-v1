// Lessons (owner approval 3 Nov 2026, "Learn from every correction"): when a person corrects an agent (edits its draft, says no, undoes or declines what it did, rewrites its answer) the agent keeps
// a short lesson and does better next time. A lesson is an ordinary memory fact of kind "lesson": a person-layer fact kept by that agent, sealed under the person's own key, shown in the Learned feed
// with Undo, recalled on every later turn of that agent for that person, and only ever the person's own. There is no second store.
// Privacy: a lesson is private to the person who corrected (a person-layer fact is never read into a chat other people read). Sharing one goes through memory.promote, so a person accepts it. In a chat
// other people read, a lesson may only use words that chat already shows, so no private fact can ride along. With the switch (setting memory.lessons) off nothing is kept.
import { emitAccepted, emitLearned, emitProposed, insertFact, normal } from "./factcore.ts";
import { actorOf, readFact, rowsOf, str } from "./projections.ts";
import type { Fact, FactStatus, MemCtx } from "./projections.ts";
import type { Who } from "./trail.ts";

export const LESSON = "lesson";
export type How = "edit" | "refuse" | "reverse" | "rewrite";
export const HOWS: ReadonlySet<string> = new Set(["edit", "refuse", "reverse", "rewrite"]);

/** The switch "Learn from my corrections" (Settings, Memory): on unless the person turned it off. A setting that cannot be read leaves it on, as the person last saw it. */
export async function lessonsOn(ctx: Pick<MemCtx, "call">): Promise<boolean> {
  try {
    const r = (await ctx.call("settings.get", { key: "memory.lessons" })) as { row?: { value?: unknown } } | null | undefined;
    return r?.row?.value !== false;
  } catch { return true; }
}

// ---- the free rules: a correction in the person's own words

const SENTENCES = (s: string): string[] => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x !== "");
const NO = /^(?:no|nope|nah)\b[\s,.:;!-]*/i;
const REVERSE = /^(?:undo|revert|roll (?:it|that|this) back|take (?:it|that|this) back|put (?:it|that|this) back)\b/i;
const REFUSE = /^(?:don'?t|do not|never|stop|please (?:don'?t|stop)|not like that|that'?s (?:wrong|not right|not what i)|wrong\b|show me\b.{0,60}\bfirst)/i;
const REWRITE = /^(?:rewrite|redo|re-?do|make (?:it|that|this)|keep (?:it|them)|shorten|too (?:long|short|formal|casual|wordy)|shorter|instead|actually)\b/i;

export interface Spotted { how: How; text: string }

/** What a person's line says about what the agent just did, when it is a correction: the words they used, trimmed to one short lesson. Null when it is not one. */
export function correctionOf(body: string): Spotted | null {
  const sentences = SENTENCES(body.replace(/\s+/g, " "));
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const bare = s.replace(NO, "").replace(/^(?:but|and|so|well)\b[\s,]*/i, "").trim();
    const startsNo = NO.test(s);
    const how: How | null = REVERSE.test(bare) ? "reverse" : startsNo || REFUSE.test(bare) ? "refuse" : REWRITE.test(bare) ? "rewrite" : null;
    if (how === null) continue;
    // the correction and, when it is a short one, the sentence that finishes it ("Don't send it yet. Show me first.")
    const next = sentences[i + 1];
    const text = [bare, next !== undefined && next.length <= 80 && !next.endsWith("?") ? next : ""].filter((x) => x !== "").join(" ").trim();
    if (text.length < 8) continue;
    const out = `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`.slice(0, 200);
    return { how, text: out };
  }
  return null;
}

/** The lesson a correction made outside the chat leaves when no model words it: the person's own note, else the plainest sentence the facts allow. Null: nothing safe to say. */
export function lessonText(i: { how: How; was?: string; now?: string; note?: string }, shared: boolean): string | null {
  const note = (i.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length >= 8) return `${note.slice(0, 1).toUpperCase()}${note.slice(1)}`.slice(0, 200);
  // a chat other people read: the draft and the action may hold their words, so with no note of the person's own there is nothing to keep
  if (shared) return null;
  const was = (i.was ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const now = (i.now ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  switch (i.how) {
    case "edit": return now.length >= 8 ? `Write drafts the way I edited this one: "${now}"` : null;
    case "rewrite": return now.length >= 8 ? `Answer the way I rewrote it: "${now}"` : null;
    case "refuse": return was.length >= 4 ? `Ask me before you do this again: ${was}` : null;
    case "reverse": return was.length >= 4 ? `I undid this, so check with me before you do it again: ${was}` : null;
  }
}

/** In a chat other people read: every word of five letters or more in the lesson must already be on the screen, so nothing from private memory can ride along. */
export function groundedIn(text: string, visible: readonly string[]): boolean {
  const seen = new Set(visible.join(" ").toLowerCase().match(/[a-z0-9']{5,}/g) ?? []);
  return (text.toLowerCase().match(/[a-z0-9']{5,}/g) ?? []).every((w) => seen.has(w));
}

// ---- writing

export interface LessonIn {
  agentId: string; how: How; text: string; who: Who; key: string;
  /** The chat the correction was made in, and the line, when there is one. */
  threadId?: string | undefined; messageId?: string | undefined; sourceKind: "chat" | "channel" | "manual";
  /** What the chat's audience adds (the default seam in learn.ts): the people who heard it said. */
  audience: Array<[string, string]>;
  /** The agent's capture mode: propose leaves the lesson for the person to accept; anything else keeps it at once (it is only theirs). */
  propose: boolean;
}

/** Keep one lesson. Null when this correction already made one or the person already has the same words. */
export function writeLesson(ctx: MemCtx, l: LessonIn): Fact | null {
  const me = actorOf(ctx);
  if (rowsOf(ctx.db, "SELECT fact_id FROM memory_fact_links WHERE kind = 'capture' AND ref = ?", l.key)[0]) return null;
  const want = normal(l.text);
  const live = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND agent_id = ? AND kind = ? AND status IN ('current', 'proposed')", me, l.agentId, LESSON)
    .map((r) => readFact(ctx, r));
  if (live.some((f) => normal(f.text) === want)) return null;
  const status: FactStatus = l.propose ? "proposed" : "current";
  const sourceRef = l.threadId ?? l.agentId;
  const fact = insertFact(ctx, {
    layer: "person", ownerRef: me, agentId: l.agentId, projectId: null, kind: LESSON, text: l.text, validFrom: ctx.now(), sourceKind: l.sourceKind, sourceRef, sourcePerson: me,
    proposedBy: ctx.principal.id, status, lowRisk: false,
    links: [["capture", l.key], ["how", l.how], ...(l.messageId ? ([["message", l.messageId]] as Array<[string, string]>) : []), ...l.audience],
    ...(l.threadId && l.messageId ? { sourceLink: `/chats/${l.threadId}#${l.messageId}` } : l.threadId ? { sourceLink: `/chats/${l.threadId}` } : {}),
    how: "learn", who: l.who, why: `lesson:${l.how}`,
  });
  emitProposed(ctx, fact);
  emitLearned(ctx, fact, status === "current", l.who);
  if (status === "current") emitAccepted(ctx, fact, true);
  return fact;
}

// ---- reading: what a lesson row carries beyond a fact

export interface LessonExtras { how?: How; used: number; scope: "you" | "proposed" | "space" }

/** How the correction was made, how many answers used the lesson, and who may read it: only the person, waiting for a person to accept sharing it, or kept for the Space. */
export function lessonExtras(ctx: Pick<MemCtx, "db">, f: Pick<Fact, "id">): LessonExtras {
  const how = str(rowsOf(ctx.db, "SELECT ref FROM memory_fact_links WHERE fact_id = ? AND kind = 'how' LIMIT 1", f.id)[0]?.["ref"]);
  let used = 0;
  try { used = Number(rowsOf(ctx.db, "SELECT COUNT(DISTINCT message_id) AS n FROM memory_recall_log WHERE kind = 'fact' AND ref = ?", f.id)[0]?.["n"] ?? 0); } catch { used = 0; }
  const promo = rowsOf(ctx.db, "SELECT status FROM memory_promotions WHERE fact_id = ? ORDER BY requested_at DESC LIMIT 1", f.id)[0];
  const scope = promo ? (str(promo["status"]) === "approved" ? "space" : str(promo["status"]) === "pending" ? "proposed" : "you") : "you";
  return { ...(HOWS.has(how) ? { how: how as How } : {}), used, scope };
}
