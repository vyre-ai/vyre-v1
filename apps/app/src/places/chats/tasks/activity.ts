// Activity is one feed: the task's thread, with its status changes and hand-offs woven in as quiet lines. tasks.history says what happened; these turn into the same event lines a chat draws, by time, so the feed is one
// timeline. Everything, Comments and Updates are one filter over it.
import type { Message } from "../conversation/model.ts";

export type ActivityShow = "all" | "comments" | "updates";
interface Entry { at: number; type: string; by: string; note?: string; eventId: string }

const WORDS: Record<string, (who: string) => string> = {
  created: (w) => `${w} created this`,
  transitioned: (w) => `${w} changed the status`,   // a line from before the history named where it went
  completed: (w) => `${w} marked this Done`,
  assigned: (w) => `${w} changed who is on this`,
  doing: (w) => `${w} moved this to Doing`,
  in_review: (w) => `${w} handed this in for review`,
  awaiting_approval: (w) => `${w} sent this for approval`,
  canceled: (w) => `${w} canceled this`,
  todo: (w) => `${w} reopened this`,
  sent_back: (w) => `${w} sent this back`,
  approved: (w) => `${w} approved this`,
  rejected: (w) => `${w} rejected this`,
  snoozed: (w) => `${w} snoozed this`,
  withdrawn: (w) => `${w} withdrew this`,
  delegated: (w) => `${w} handed this over`,
  taken: (w) => `${w} took this`,
  released: (w) => `${w} gave this back`,
  escalated: () => "This went to someone else after it waited too long",
  ready: () => "Everything this waited on is done",
  children_settled: () => "The tasks under this need attention",
};

const BORN_MS = 2000;

/** The history of a task as event lines of its thread. Fine detail (notes, followers, field edits) stays in the record's history. */
export function activityOf(entries: readonly Entry[], threadId: string, nameOf: (id: string) => string): Message[] {
  const out: Message[] = [];
  let madeAt = -BORN_MS;
  // tasks.history is newest first; two lines from one moment read in the order they happened
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.type === "created") madeAt = e.at;
    // who a task was born with is not a change
    if (e.type === "assigned" && e.at - madeAt < BORN_MS) continue;
    const say = WORDS[e.type.replace(/^task\./, "").replace(/^transitioned:/, "")];
    if (!say) continue;
    const body = `${say(nameOf(e.by))}${e.note ? `: ${e.note}` : ""}`;
    out.push({ messageId: `act:${e.eventId}`, threadId, threadSeq: 0, kind: "quiet", body, blocks: [], createdAt: e.at, author: { kind: "person", id: e.by } } as unknown as Message);
  }
  return out;
}

/** The thread's messages and the quiet lines, in the order they happened. */
export function weave(messages: readonly Message[], events: readonly Message[]): Message[] {
  if (events.length === 0) return [...messages];
  return [...messages, ...events].sort((a, b) => a.createdAt - b.createdAt);
}

/** What the filter keeps. A status line is an update, a word from someone is a comment, and an agent's work is both. */
export function keepItem(m: Message, show: ActivityShow): boolean {
  if (show === "all") return true;
  const line = m.kind === "system" || m.kind === "quiet";
  return show === "updates" ? line || m.blocks.length > 0 : !line;
}
