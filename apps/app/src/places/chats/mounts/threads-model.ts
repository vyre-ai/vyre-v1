// The Threads page as plain data (audit Threads 4, 6): one row per thread I am in, newest reply first, with where it hangs, the newest line and who wrote it, when, and how much is new.
// J and K move the selection, Enter opens it. Pure: RepliesPage draws what these return.
import { chatWhen } from "../rightpane/model.ts";
import type { Clock } from "../rightpane/model.ts";

export interface ThreadLike {
  threadId: string; title?: string | undefined; parentTitle?: string | undefined; preview?: string | undefined; lastMessageAt?: number | undefined; createdAt: number;
  repliers?: readonly { kind: string; id: string }[] | undefined; unread?: number | undefined; muted?: boolean | undefined; following?: boolean | undefined; replyCount?: number | undefined;
}

export interface ThreadView {
  threadId: string; title: string; note: string; when: string; unread: number; bold: boolean; muted: boolean;
  faces: readonly { id: string; kind: "person" | "agent" }[];
}

export function threadView(t: ThreadLike, nameOf: (id: string) => string, c: Clock): ThreadView {
  const who = t.repliers?.[0];
  const line = t.preview ? `${who ? `${nameOf(who.id)}: ` : ""}${t.preview}` : t.replyCount ? `${t.replyCount} ${t.replyCount === 1 ? "reply" : "replies"}` : "No replies yet";
  const unread = t.muted ? 0 : t.unread ?? 0;
  return {
    threadId: t.threadId, title: t.parentTitle ?? t.title ?? "A chat", note: line, when: chatWhen(t.lastMessageAt ?? t.createdAt, c), unread, bold: unread > 0, muted: t.muted === true,
    faces: (t.repliers ?? []).slice(0, 3).map((r) => ({ id: r.id, kind: r.kind === "agent" ? "agent" : "person" })),
  };
}

/** Pages read with a cursor join the live first page: a thread already shown is not shown twice, and the live page's copy of a row wins. */
export function mergeThreadPages<T extends { threadId: string }>(first: readonly T[], more: readonly T[]): T[] {
  const seen = new Set(first.map((t) => t.threadId));
  return [...first, ...more.filter((t) => !seen.has(t.threadId))];
}

/** J and K move down and up the list (stopping at the ends), from nothing selected to the first row. Null for any other key. */
export function moveSelection(ids: readonly string[], current: string | null, key: string): string | null {
  if (ids.length === 0) return null;
  const k = key.toLowerCase();
  if (k !== "j" && k !== "k") return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return ids[0]!;
  const next = k === "j" ? Math.min(ids.length - 1, at + 1) : Math.max(0, at - 1);
  return ids[next]!;
}

/** A key typed into a field is the field's, never the list's. */
export function typing(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (el.isContentEditable === true || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** The Threads row on the phone's You tab: how many replies are new in the threads I am in. */
export function threadsNote(n: number): string {
  return n === 0 ? "Nothing new" : `${n} new ${n === 1 ? "reply" : "replies"}`;
}
