// @reads /modules/chat/migrations/0007_mentions.sql
// How a teammate answers (the profile's "How <name> responds here"): their usual reply time and, for one chat, how they hear about it. A plain read from chats the ASKER is in, so it never draws on a
// place the asker cannot open: a chat the asker is not a member of is never read, whoever else is in it.
//   Replies: from the last 30 days of chats both are in, the time from a message that asked something of them (a mention of them by person id, a reply to their message, or any line from the other
//            person in a direct chat) until their next message in that chat. Mentions are the composer's chips, kept per message (chat_mention); a name typed as plain words is not one. The median is the answer; fewer than three such moments is "unknown", never a guess.
//   Notifies: for one chat both are in. A direct chat tells them of every message (message.direct); a group chat or channel tells them of @mentions and followed threads (notify.ts); a thread they
//            left says off, which the members of it can see. A mute made in Notifications settings is private to them and is never read here (owner ruling, 4 Nov).
import { readFileSync } from "node:fs";
import { askerOf, membersOf, refOf } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { followMode } from "./follow.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** A wait longer than this is a message nobody was waiting on, not a slow reply. */
export const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_SAMPLES = 3;
const MAX_THREADS = 200;
const MAX_MESSAGES = 2000;

export type Pace = "minutes" | "hour" | "day" | "slow" | "unknown";
export type Notifies = "all" | "mentions" | "off";

/** The words for a median wait: up to 15 minutes, up to an hour, up to a day, longer. */
export function paceOf(waits: readonly number[]): Pace {
  if (waits.length < MIN_SAMPLES) return "unknown";
  const s = [...waits].sort((a, b) => a - b);
  const mid = s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  if (mid <= 15 * 60_000) return "minutes";
  if (mid <= 60 * 60_000) return "hour";
  if (mid <= 24 * 60 * 60_000) return "day";
  return "slow";
}

const SCHEMA = readFileSync(new URL("../migrations/0007_mentions.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((x) => x.trim()).filter((x) => x.length > 0);
const ready = new WeakSet<object>();
/** The table is the module's 0007 migration; a database that has not run it yet (a fresh test handle) gets the same statements once. */
function ensureMentionTable(ctx: Pick<ChatCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try { ctx.db.all('SELECT message FROM chat_mention WHERE message = ?', "probe"); } catch { for (const stmt of SCHEMA) ctx.db.run(stmt); }
  ready.add(ctx.db);
}

/** Forgets mentions (memory rule 9): those of one message, of every message in a thread, or of one person who was mentioned. */
export function forgetMentions(ctx: Pick<ChatCtx, "db">, what: { message?: string; thread?: string; person?: string }): void {
  ensureMentionTable(ctx);
  if (what.message !== undefined) ctx.db.run('DELETE FROM chat_mention WHERE "message" = ?', what.message);
  if (what.thread !== undefined) ctx.db.run('DELETE FROM chat_mention WHERE "thread" = ?', what.thread);
  if (what.person !== undefined) ctx.db.run('DELETE FROM chat_mention WHERE "person" = ?', what.person);
}

/** Keeps who a message mentioned, by person id: the composer's chips. The reply-time read matches on these, never on a name in the words. */
export function recordMentions(ctx: Pick<ChatCtx, "db" | "now">, messageId: string, threadId: string, mentions: ReadonlyArray<{ kind: string; id: string }>): void {
  const people = [...new Set(mentions.filter((m) => m.kind === "person").map((m) => m.id))];
  if (people.length === 0) return;
  ensureMentionTable(ctx);
  for (const id of people) ctx.db.run('INSERT OR IGNORE INTO chat_mention ("message", "thread", "person", "at") VALUES (?, ?, ?, ?)', messageId, threadId, id, ctx.now());
}

export async function paceOfPerson(ctx: ChatCtx, input: { personId: string; threadId?: string }): Promise<{ replies: Pace; samples: number; notifies?: Notifies }> {
  const me = askerOf(ctx);
  const them = input.personId;
  const out: { replies: Pace; samples: number; notifies?: Notifies } = { replies: "unknown", samples: 0 };
  if (!them.startsWith("usr_") || them === me) return out;
  // only chats the asker is in, with the other person in them too
  const rows = ctx.db.all(
    `SELECT t."id" AS "id", t."kind" AS "kind" FROM chat_thread t
       WHERE t."deleted_at" IS NULL AND t."kind" IN ('chat', 'channel', 'thread')
         AND EXISTS (SELECT 1 FROM chat_thread_member a WHERE a."thread" = t."id" AND a."principal" = ? AND a."deleted_at" IS NULL)
         AND EXISTS (SELECT 1 FROM chat_thread_member b WHERE b."thread" = t."id" AND b."principal" = ? AND b."deleted_at" IS NULL)
       LIMIT ${MAX_THREADS}`, me, them,
  ) as Row[];
  ensureMentionTable(ctx);
  const since = ctx.now() - WINDOW_MS;
  const waits: number[] = [];
  for (const r of rows) {
    const id = str(r["id"]);
    const people = membersOf(ctx.db, id).filter((p) => p.startsWith("usr_"));
    const direct = people.length === 2;
    const msgs = ctx.db.all(
      `SELECT "id", "author", "kind", "body", "replyTo", "createdAt" FROM chat_message WHERE "thread" = ? AND "createdAt" >= ? AND "deleted_at" IS NULL AND "kind" = 'text' ORDER BY "threadSeq" LIMIT ${MAX_MESSAGES}`, id, since,
    ) as Row[];
    const named = new Set((ctx.db.all('SELECT "message" FROM chat_mention WHERE "thread" = ? AND "person" = ?', id, them) as Row[]).map((m) => str(m["message"])));
    const mine = new Set(msgs.filter((m) => str(m["author"]) === them).map((m) => str(m["id"])));
    let waiting: number | null = null;   // the time of the earliest line still waiting on them
    for (const m of msgs) {
      const author = str(m["author"]);
      const at = Number(m["createdAt"]);
      if (author === them) {
        if (waiting !== null && at - waiting <= MAX_WAIT_MS) waits.push(at - waiting);
        waiting = null;
        continue;
      }
      if (refOf(author).kind !== "person" || waiting !== null) continue;
      const asked = direct || (typeof m["replyTo"] === "string" && mine.has(m["replyTo"])) || named.has(str(m["id"]));
      if (asked) waiting = at;
    }
  }
  out.replies = paceOf(waits);
  out.samples = waits.length;
  // how they hear about this one chat, when the asker is in it with them
  if (input.threadId !== undefined) {
    const t = rows.find((r) => str(r["id"]) === input.threadId);
    if (t !== undefined) {
      const people = membersOf(ctx.db, input.threadId).filter((p) => p.startsWith("usr_"));
      out.notifies = followMode(ctx, input.threadId, them) === "left" ? "off" : people.length === 2 ? "all" : "mentions";
    }
  }
  return out;
}
