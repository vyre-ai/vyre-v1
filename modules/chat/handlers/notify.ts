// What a person hears about a conversation (spec 2.24): a direct message, an @mention and a reply in a thread they follow become notifications. Chat knows where a message was and who it
// reaches; notifications.send decides how loud (working hours, quiet hours, away, mutes, the agent cap) and collapses a burst in one thread into one row ("3 new replies in #intake").
// A mention in a task's thread also makes that person a follower of the task, so they hear how the task goes. Runs as the consumer chat.notify (impl.ts), after the message is stored.
import { encOf, messageBy, refOf, threadBy } from "../projections.ts";
import type { ChatCtx, MessageRec, ThreadRec } from "../projections.ts";
import { placeOf } from "./follow.ts";

export interface NotifyEvent { name: string; payload: Record<string, unknown> }
interface Send { to: string; kind: "dm" | "mention" | "reply.thread"; subject: { type: string; id: string }; data: Record<string, unknown>; body?: string; collapseKey?: string }

export const NOTIFY_EVENTS = ["message.mentioned", "message.direct", "thread.replied"] as const;

/** The first line of a message, short, where the server may read it. A private chat's words never leave it. */
export function previewOf(ctx: Pick<ChatCtx, "db">, t: ThreadRec, m: MessageRec): string | undefined {
  if (encOf(ctx.db, t) !== 0) return undefined;
  const line = m.body.split("\n").map((x) => x.trim()).find((x) => x !== "");
  if (!line) return undefined;
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/** A name for the person or agent who wrote: the Space's own directory, else a plain word. */
async function nameOf(ctx: ChatCtx, id: string): Promise<string> {
  const ref = refOf(id);
  try {
    const out = (await ctx.call?.("access.principals.get", { principal: { kind: ref.kind, id } })) as { principal?: { name?: unknown } } | undefined;
    const name = out?.principal?.name;
    if (typeof name === "string" && name.trim() !== "") return name.trim();
  } catch { /* the directory cannot be read: the plain word below */ }
  return ref.kind === "agent" ? "An agent" : "Someone";
}

/** What one event says, to whom. Undefined when it files nothing. */
export async function planNotice(ctx: ChatCtx, e: NotifyEvent): Promise<Send | undefined> {
  const p = e.payload;
  const t = typeof p["threadId"] === "string" ? threadBy(ctx.db, p["threadId"]) : null;
  const m = typeof p["messageId"] === "string" ? messageBy(ctx.db, p["messageId"]) : null;
  const to = typeof p["personId"] === "string" ? p["personId"] : "";
  if (!t || !m || !to.startsWith("usr_") || m.author === to) return undefined;
  // a task's thread carries its status lines: the task tells its people about those itself
  if (e.name === "thread.replied" && t.scopeType === "task") return undefined;
  const author = refOf(m.author);
  const data: Record<string, unknown> = { from: await nameOf(ctx, m.author), where: placeOf(ctx, t), threadId: t.id, messageId: m.id };
  if (author.kind === "person") data["fromId"] = m.author;
  if (author.kind === "agent") data["agentId"] = m.author;
  if (t.channelId !== undefined) data["channelId"] = t.channelId;
  const body = previewOf(ctx, t, m);
  const base = { to, subject: { type: "thread", id: t.id }, data, ...(body !== undefined ? { body } : {}) };
  if (e.name === "message.direct") return { ...base, kind: "dm" };
  if (e.name === "message.mentioned") return { ...base, kind: "mention", collapseKey: `mention:${t.id}:${m.id}` };
  if (e.name === "thread.replied") return { ...base, kind: "reply.thread", collapseKey: `reply.thread:${t.id}` };
  return undefined;
}

/** The consumer: file the notification, and for a mention in a task's thread make the person a follower of the task. Never throws: a notice that cannot be filed is logged, not retried for ever. */
export async function notify(ctx: ChatCtx, e: NotifyEvent): Promise<string[]> {
  const out: string[] = [];
  if (!ctx.call) return out;
  if (e.name === "message.mentioned") {
    const t = typeof e.payload["threadId"] === "string" ? threadBy(ctx.db, e.payload["threadId"]) : null;
    const to = String(e.payload["personId"] ?? "");
    if (t?.scopeType === "task" && t.scopeId && to.startsWith("usr_")) {
      try { await ctx.call("tasks.followers.add", { taskId: t.scopeId, follower: to }); out.push(`follower:${to}`); }
      catch (x) { ctx.log.warn("could not make the person a follower of the task", { taskId: t.scopeId, error: (x as Error).message }); }
    }
  }
  const send = await planNotice(ctx, e);
  if (!send) return out;
  try {
    const r = (await ctx.call("notifications.send", send)) as { notificationId?: string } | undefined;
    if (r?.notificationId) out.push(r.notificationId);
  } catch (x) { ctx.log.warn("could not file the notification", { kind: send.kind, error: (x as Error).message }); }
  return out;
}
