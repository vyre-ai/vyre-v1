// Right pane > Everything: one feed of what has happened around this record, newest first: edits, comments, mail and texts, files, tasks, runs, chats and meetings. Each source is an ordinary read made as the
// person, so what they may not see never arrives (a source that answers no is left out, and the feed says nothing about it). This file is the pure part: turning each answer into feed items and merging them.
import { RESOURCE_OF } from "../../../shell/reach/policy.ts";
import { hiddenTitle } from "../../../../../../ui/src/blocks/link-card/state.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { TypeDef } from "../recordpage/model.ts";
import { activityLine } from "./model.ts";

export type Kind = "edit" | "comment" | "mail" | "text" | "call" | "meeting" | "file" | "task" | "run" | "chat";
export interface Item {
  /** unique across sources */
  id: string;
  kind: Kind;
  at: number;
  /** one line */
  title: string;
  /** a second, quieter line */
  note?: string;
  /** who did it, when the source says */
  actor?: string;
  /** where a tap goes; an item with none is not a link */
  subject?: { type: string; id: string };
}

/** The words that name a kind at the left of a row. */
export const KIND_LABEL: Readonly<Record<Kind, string>> = { edit: "Edit", comment: "Comment", mail: "Email", text: "Text", call: "Call", meeting: "Meeting", file: "File", task: "Task", run: "Run", chat: "Chat" };

const clip = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Activity = CapMap["records.activity"]["out"]["entries"][number];
export const fromActivity = (rows: readonly Activity[], def: TypeDef | undefined, names: (id: string) => string): Item[] =>
  rows.map((e) => ({ id: `edit:${e.id}`, kind: "edit", at: e.at, title: activityLine(e, def, names), ...(e.actor ? { actor: e.actor } : {}) }));

type Comment = CapMap["records.comments.list"]["out"]["comments"][number];
export const fromComments = (rows: readonly Comment[], names: (id: string) => string): Item[] =>
  rows.map((c) => ({ id: `comment:${c.commentId}`, kind: "comment", at: c.at, title: clip(c.text), note: `${names(c.by)} commented${c.parentId ? " in reply" : ""}`, actor: c.by }));

type TimelineItem = CapMap["inbox.thread"]["out"]["items"][number];
const MAIL_KIND: Partial<Record<TimelineItem["kind"], Kind>> = { email: "mail", sms: "text", call: "call", meeting: "meeting" };
export const fromConversation = (rows: readonly TimelineItem[]): Item[] =>
  rows.flatMap((m): Item[] => {
    const kind = MAIL_KIND[m.kind];
    if (!kind) return [];
    const way = m.direction === "out" ? "Sent" : "Received";
    return [{ id: `${kind}:${m.id}`, kind, at: m.at, title: clip(m.title ?? m.preview ?? KIND_LABEL[kind]), note: m.title && m.preview ? `${way}. ${clip(m.preview, 80)}` : way }];
  });

type FileRow = CapMap["files.list"]["out"]["files"][number];
export const fromFiles = (rows: readonly FileRow[], names: (id: string) => string): Item[] =>
  rows.filter((f) => f.deletedAt === undefined).map((f) => ({ id: `file:${f.fileId}`, kind: "file", at: f.updatedAt, title: f.name, note: `${names(f.updatedBy)} updated it`, actor: f.updatedBy, subject: { type: "file", id: f.fileId } }));

type Task = CapMap["tasks.list"]["out"]["tasks"][number];
export const fromTasks = (rows: readonly Task[]): Item[] =>
  rows.map((t) => ({ id: `task:${t.id}`, kind: "task", at: t.updatedAt, title: t.title, note: t.state === "done" ? "Done" : t.state === "todo" ? "To do" : t.state.replace(/_/g, " "), subject: { type: "task", id: t.id } }));

type Run = CapMap["runs.list"]["out"]["runs"][number];
export const fromRuns = (rows: readonly Run[]): Item[] =>
  rows.map((r) => ({ id: `run:${r.id}`, kind: "run", at: r.endedAt ?? r.startedAt, title: r.name ?? "A run", note: r.status.replace(/_/g, " "), subject: { type: "run", id: r.id } }));

type Thread = CapMap["threads.list"]["out"]["threads"][number];
export const fromThreads = (rows: readonly Thread[]): Item[] =>
  rows.map((t) => ({ id: `chat:${t.threadId}`, kind: "chat", at: t.lastMessageAt ?? t.createdAt, title: t.title ?? "Chat", ...(t.replyCount ? { note: `${t.replyCount} ${t.replyCount === 1 ? "message" : "messages"}` } : {}), subject: { type: "thread", id: t.threadId } }));

type Meeting = CapMap["meetings.closeout.list"]["out"]["meetings"][number];
const MEETING_STATE: Readonly<Record<Meeting["state"], string>> = { ready: "Ready to close", closed: "Closed", nothing: "Nothing to do", preparing: "Preparing" };
/** The meetings this record was in (or that proposed something for it), with where their close-out stands; a tap opens the close-out in the Inbox's Meetings tab. */
export const fromMeetings = (rows: readonly Meeting[]): Item[] =>
  rows.map((m) => ({
    id: `meeting:${m.meetingId}`, kind: "meeting", at: m.startsAt, title: m.title,
    note: `${MEETING_STATE[m.state]}${m.done ? ` · ${m.done} done` : ""}${m.state === "ready" && m.proposed ? ` · ${m.proposed} to approve` : ""}`, subject: { type: "meeting", id: m.meetingId },
  }));

/** Newest first, one item per id, at most `limit`. */
export function merge(lists: readonly (readonly Item[])[], limit = 100): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of lists.flat().sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export type Call = (cap: string, input: unknown) => Promise<unknown>;

/**
 * Read every source as the person and merge. A source that fails (no access, or the record is not that kind of thing: only a contact has a mail history) adds nothing and is not reported:
 * what a person may not see is not hinted at. `folderOf` finds the record's own folder, if it has one.
 */
export async function loadEverything(o: { call: Call; type: string; recordId: string; def?: TypeDef | undefined; names: (id: string) => string; folderOf: () => Promise<string | null> }): Promise<Item[]> {
  const ask = async <T,>(cap: string, input: unknown): Promise<T | null> => { try { return (await o.call(cap, input)) as T; } catch { return null; } };
  const [activity, comments, thread, tasks, runs, threads, files, meetings] = await Promise.all([
    ask<CapMap["records.activity"]["out"]>("records.activity", { type: o.type, recordId: o.recordId, limit: 50 }),
    ask<CapMap["records.comments.list"]["out"]>("records.comments.list", { type: o.type, recordId: o.recordId, includeResolved: true }),
    ask<CapMap["inbox.thread"]["out"]>("inbox.thread", { contactId: o.recordId, limit: 50 }),
    ask<CapMap["tasks.list"]["out"]>("tasks.list", { scope: "record", recordId: o.recordId, limit: 50 }),
    ask<CapMap["runs.list"]["out"]>("runs.list", { scope: "subject", subject: { type: "record", id: o.recordId }, limit: 50 }),
    ask<CapMap["threads.list"]["out"]>("threads.list", { recordId: o.recordId, limit: 50 }),
    (async () => { const folder = await o.folderOf().catch(() => null); return folder ? ask<CapMap["files.list"]["out"]>("files.list", { folder, limit: 50 }) : null; })(),
    ask<CapMap["meetings.closeout.list"]["out"]>("meetings.closeout.list", { recordId: o.recordId, limit: 50 }),
  ]);
  const feed = merge([
    fromActivity(activity?.entries ?? [], o.def, o.names), fromComments(comments?.comments ?? [], o.names), fromConversation(thread?.items ?? []), fromFiles(files?.files ?? [], o.names),
    fromTasks(tasks?.tasks ?? []), fromRuns(runs?.runs ?? []), fromThreads(threads?.threads ?? []), fromMeetings(meetings?.meetings ?? []),
  ]);
  return withReach(o.call, feed);
}

/**
 * The feed is drawn once, with each row's level already known: one access.reach for every thing the rows point at, before the first draw, so no row flips after it shows. A row for a thing the
 * person cannot open keeps its kind and its time and loses its name and its link: it says what kind of thing it is, and nothing about it. A Space that does not answer leaves the rows as they are.
 */
export async function withReach(call: Call, feed: Item[]): Promise<Item[]> {
  const asked = new Map<string, { type: string; id: string }>();
  for (const it of feed) {
    const type = it.subject ? RESOURCE_OF[it.subject.type] : undefined;
    if (it.subject && type) asked.set(`${type}:${it.subject.id}`, { type, id: it.subject.id });
  }
  if (asked.size === 0) return feed;
  const level = new Map<string, string>();
  try {
    const out = (await call("access.reach", { items: [...asked.values()].slice(0, 200) })) as { items?: Array<{ type: string; id: string; level: string }> };
    for (const r of out.items ?? []) level.set(`${r.type}:${r.id}`, r.level);
  } catch { return feed; }
  return feed.map((it) => {
    const type = it.subject ? RESOURCE_OF[it.subject.type] : undefined;
    if (!it.subject || !type || level.get(`${type}:${it.subject.id}`) !== "none") return it;
    const { subject: _s, note: _n, ...rest } = it;
    return { ...rest, title: hiddenTitle(it.subject.type) };
  });
}
