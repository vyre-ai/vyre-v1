// The line under a message that has a thread (audit Threads 3): who replied, how many, when the last one came, bold while something in it is new to me. Read from the threads hanging
// off the chat (threads.list by parent), one read per chat, live. Pure: the view draws what these functions return.
import { chatWhen } from "../rightpane/model.ts";
import type { Clock } from "../rightpane/model.ts";

export interface ReplyFace { id: string; kind: "person" | "agent" }
export interface ReplySummary { threadId: string; count: number; lastAt?: number; people: readonly ReplyFace[]; unread: number; muted: boolean }

interface ThreadLike {
  threadId: string; kind: string; parentMessageId?: string | undefined; replyCount?: number | undefined; lastMessageAt?: number | undefined;
  repliers?: readonly { kind: string; id: string }[] | undefined; unread?: number | undefined; muted?: boolean | undefined;
}

/** The reply threads of a chat by the message each hangs off. A thread nobody has written in yet draws no line. */
export function replySummaries(threads: readonly ThreadLike[]): Map<string, ReplySummary> {
  const out = new Map<string, ReplySummary>();
  for (const t of threads) {
    if (t.kind !== "thread" || !t.parentMessageId || !t.replyCount) continue;
    out.set(t.parentMessageId, {
      threadId: t.threadId, count: t.replyCount, ...(t.lastMessageAt !== undefined ? { lastAt: t.lastMessageAt } : {}),
      people: (t.repliers ?? []).slice(0, 3).map((r) => ({ id: r.id, kind: r.kind === "agent" ? "agent" : "person" })), unread: t.muted ? 0 : t.unread ?? 0, muted: t.muted === true,
    });
  }
  return out;
}

/** "3 replies", "Last reply 14:05" (or Yesterday, a weekday, a date), and whether it reads bold. */
export function replyWords(s: ReplySummary, c: Clock): { count: string; when: string | null; bold: boolean; label: string } {
  const count = `${s.count} ${s.count === 1 ? "reply" : "replies"}`;
  const when = s.lastAt === undefined ? null : `Last reply ${chatWhen(s.lastAt, c)}`;
  const bold = s.unread > 0;
  const label = [count, bold ? `${s.unread} new` : null, when].filter((x) => x !== null).join(", ");
  return { count, when, bold, label };
}
