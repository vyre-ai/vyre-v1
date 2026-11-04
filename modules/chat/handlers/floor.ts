// Where a person's reading of a chat starts (lane l-addsheet, owner ruling 4 Nov 2026). A person added to a private chat reads from the moment they were added unless "Include earlier messages" was on;
// the time is chat_thread_member.fromAt on the chat's root, and it holds for the chat and every thread under it. Every read a person (or an agent working for them) makes goes through it:
// the message list, a single message, pins, reading further back, the catch-up, search, a fork. An agent acting for nobody (its own principal) reads all of it.
import { askerOf, ensure } from "../projections.ts";
import type { ChatCtx, ThreadRec } from "../projections.ts";
import { rootOf } from "./post.ts";

type Row = Record<string, unknown>;

/** The earliest time the caller may read in this chat; 0 when all of it. */
export function readFloor(ctx: ChatCtx, t: ThreadRec): number {
  if (ctx.principal.kind === "agent" && ctx.actingFor === undefined) return 0;
  ensure(ctx.db);
  const root = rootOf(ctx, t);
  const row = (ctx.db.all("SELECT fromAt FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", root.id, askerOf(ctx)) as Row[])[0];
  const at = Number(row?.["fromAt"] ?? 0);
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/** The floor of one person in one chat (a search across chats asks per chat). */
export function floorOfPerson(ctx: ChatCtx, rootThread: string, person: string): number {
  ensure(ctx.db);
  const row = (ctx.db.all("SELECT fromAt FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", rootThread, person) as Row[])[0];
  const at = Number(row?.["fromAt"] ?? 0);
  return Number.isFinite(at) && at > 0 ? at : 0;
}
