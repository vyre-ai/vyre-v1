// Following a thread (spec 2.5 Thread, 2.24 replies on things you follow). A person is in an inline thread when they opened it, wrote the message it hangs off, replied in it, were @mentioned
// in it or chose Follow; being in it is a chat_thread_member row, the same row the Threads row counts. Mute keeps them in it but quiet: its replies reach nobody's banner and count as nothing new.
// Leave takes them out, and keeps them out of the follow set of the message they wrote, until they reply or are mentioned again.
//   chat_thread_follow   (thread, principal, mode)   mode 'mute' or 'left'; no row is plain following (or not being in it at all)
import { addMember, askerOf, isMember, membersOf, messageBy, raise, refOf, threadBy } from "../projections.ts";
import type { ChatCtx, ThreadRec } from "../projections.ts";
import { load } from "./g24a.ts";

type Row = Record<string, unknown>;
type Mode = "mute" | "left";

const TABLE = 'CREATE TABLE IF NOT EXISTS "chat_thread_follow" ("thread" TEXT NOT NULL, "principal" TEXT NOT NULL, "mode" TEXT NOT NULL, "at" INTEGER NOT NULL, PRIMARY KEY ("thread", "principal"))';
const ready = new WeakSet<object>();

/** Make sure chat_thread_follow exists. Runs the CREATE once per database handle, on first use. */
export function ensureFollowTable(ctx: Pick<ChatCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  ctx.db.run(TABLE);
  ready.add(ctx.db);
}

/** A person's own setting on a thread: muted, left, or nothing (following when they are in it). */
export function followMode(ctx: Pick<ChatCtx, "db">, threadId: string, person: string): Mode | undefined {
  ensureFollowTable(ctx);
  const r = (ctx.db.all('SELECT "mode" FROM chat_thread_follow WHERE "thread" = ? AND "principal" = ?', threadId, person) as Row[])[0];
  const m = r ? String(r["mode"]) : undefined;
  return m === "mute" || m === "left" ? m : undefined;
}

function setMode(ctx: Pick<ChatCtx, "db" | "now">, threadId: string, person: string, mode: Mode | null): void {
  ensureFollowTable(ctx);
  ctx.db.run('DELETE FROM chat_thread_follow WHERE "thread" = ? AND "principal" = ?', threadId, person);
  if (mode !== null) ctx.db.run('INSERT INTO chat_thread_follow ("thread", "principal", "mode", "at") VALUES (?, ?, ?, ?)', threadId, person, mode, ctx.now());
}

/** The threads a person muted, of the ones given (for counting what is new). */
export function mutedOf(ctx: Pick<ChatCtx, "db">, person: string): Set<string> {
  ensureFollowTable(ctx);
  return new Set((ctx.db.all(`SELECT "thread" FROM chat_thread_follow WHERE "principal" = ? AND "mode" = 'mute'`, person) as Row[]).map((r) => String(r["thread"])));
}

/** A person comes into an inline thread (a reply, a mention, Follow): in it, and no longer counted as gone. A mute they chose stays. */
export function joinThread(ctx: Pick<ChatCtx, "db" | "now">, t: ThreadRec, person: string): void {
  if (t.kind !== "thread" || !person.startsWith("usr_")) return;
  addMember(ctx, t.id, person);
  if (followMode(ctx, t.id, person) === "left") setMode(ctx, t.id, person, null);
}

/**
 * Who a reply in an inline thread reaches: the people in it, whoever wrote the message above it and everyone who already replied, less those who muted or left it.
 * The people in it are counted too because a mention and Follow put someone there without them writing anything.
 */
export function followersOf(ctx: Pick<ChatCtx, "db">, t: ThreadRec): string[] {
  const out = new Set<string>();
  for (const p of membersOf(ctx.db, t.id)) if (refOf(p).kind === "person") out.add(p);
  const parent = t.parentMessageId ? messageBy(ctx.db, t.parentMessageId) : null;
  if (parent && refOf(parent.author).kind === "person") out.add(parent.author);
  for (const r of ctx.db.all("SELECT DISTINCT author FROM chat_message WHERE thread = ? AND deleted_at IS NULL", t.id) as Row[]) {
    const a = String(r["author"]);
    if (refOf(a).kind === "person") out.add(a);
  }
  ensureFollowTable(ctx);
  for (const r of ctx.db.all('SELECT "principal" FROM chat_thread_follow WHERE "thread" = ?', t.id) as Row[]) out.delete(String(r["principal"]));
  return [...out];
}

export async function follow(ctx: ChatCtx, input: { threadId: string; mode: "follow" | "mute" | "leave" }) {
  const t = load(ctx, input.threadId);
  if (ctx.principal.kind !== "person" && ctx.actingFor === undefined) raise(ctx, "validation.bad_input", "A person follows replies.");
  if (t.kind !== "thread") raise(ctx, "validation.bad_input", "Only replies to a message are followed. Leave a chat or a channel from its own menu.", { kind: t.kind });
  if (input.mode !== "follow" && input.mode !== "mute" && input.mode !== "leave") raise(ctx, "validation.bad_input", "Follow, mute or leave.");
  const person = askerOf(ctx);
  const was = isMember(ctx.db, t.id, person);
  if (input.mode === "leave") {
    if (was) {
      ctx.db.run("UPDATE chat_thread_member SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), t.id, person);
      ctx.emit("channel.member_removed", person, { personId: person, by: person, threadId: t.id });
    }
    setMode(ctx, t.id, person, "left");
    return { mode: "none" as const };
  }
  addMember(ctx, t.id, person);
  if (!was) ctx.emit("channel.member_added", person, { personId: person, by: person, threadId: t.id });
  setMode(ctx, t.id, person, input.mode === "mute" ? "mute" : null);
  return { mode: input.mode };
}

/** Where a thread hangs, in the words a notification and the Threads page use: "#intake", the chat's title, or the task's. */
export function placeOf(ctx: Pick<ChatCtx, "db">, t: ThreadRec): string {
  let cur: ThreadRec | null = t;
  for (let i = 0; cur && i < 8; i++) {
    if (cur.kind === "channel" && cur.title) return `#${cur.title}`;
    if (cur !== t && cur.title) return cur.title;
    if (cur.kind !== "thread" && cur !== t) return cur.kind === "chat" ? "a chat" : "a conversation";
    cur = cur.parentThreadId ? threadBy(ctx.db, cur.parentThreadId) : null;
  }
  return t.title ?? (t.kind === "thread" ? "a thread" : "a chat");
}

export const followHandlers = { "threads.follow": follow };
