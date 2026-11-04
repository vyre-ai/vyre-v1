// How a teammate answers (the profile's "How <name> responds here"): their usual reply time and, for one chat, how they hear about it. A plain read from chats the ASKER is in, so it never draws on a
// place the asker cannot open: a chat the asker is not a member of is never read, whoever else is in it.
//   Replies: from the last 30 days of chats both are in, the time from a message that asked something of them (an @ with their name, a reply to their message, or any line from the other person in a
//            direct chat) until their next message in that chat. The median is the answer; fewer than three such moments is "unknown", never a guess.
//   Notifies: for one chat both are in. A direct chat tells them of every message (message.direct); a group chat or channel tells them of @mentions and followed threads (notify.ts); a thread they
//            muted or left says off. Mutes made in Notifications settings belong to that module and are not read here.
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

async function nameOf(ctx: ChatCtx, id: string): Promise<string> {
  try {
    const out = (await ctx.call?.("access.principals.get", { principal: { kind: "person", id } })) as { principal?: { name?: unknown } } | undefined;
    return typeof out?.principal?.name === "string" ? out.principal.name.trim() : "";
  } catch { return ""; }
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
  const first = (await nameOf(ctx, them)).split(/\s+/)[0] ?? "";
  const full = (await nameOf(ctx, them)).toLowerCase();
  const tag = first === "" ? null : `@${first.toLowerCase()}`;
  const since = ctx.now() - WINDOW_MS;
  const waits: number[] = [];
  for (const r of rows) {
    const id = str(r["id"]);
    const people = membersOf(ctx.db, id).filter((p) => p.startsWith("usr_"));
    const direct = people.length === 2;
    const msgs = ctx.db.all(
      `SELECT "id", "author", "kind", "body", "replyTo", "createdAt" FROM chat_message WHERE "thread" = ? AND "createdAt" >= ? AND "deleted_at" IS NULL AND "kind" = 'text' ORDER BY "threadSeq" LIMIT ${MAX_MESSAGES}`, id, since,
    ) as Row[];
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
      const body = str(m["body"]).toLowerCase();
      const asked = direct || (typeof m["replyTo"] === "string" && mine.has(m["replyTo"])) || (tag !== null && body.includes(tag)) || (full !== "" && body.includes(`@${full}`));
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
      out.notifies = followMode(ctx, input.threadId, them) !== undefined ? "off" : people.length === 2 ? "all" : "mentions";
    }
  }
  return out;
}
