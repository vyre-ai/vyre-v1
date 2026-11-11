// Agents a chat made for itself, and the grants a chat gave an outside agent (lane l-addsheet). Both end with the chat or when the agent is taken out of it.
//   owned     chat_thread_agent.owned = 1: the agent was made with threads.agent.create. It goes to Trash (agents.delete) when the chat is deleted or erased, or when it is removed from the chat, and comes
//             back with threads.restore. A person who may not delete it cannot move it: the call is tolerated, never swallowed (a warning says so).
//   grants    chat_thread_agent.grants: the resources threads.outside_agent.add shared with the agent, each with the source tag chat:<threadId>. Removing the agent takes them back at once.
import { ensure, isMember } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { oneAtATime } from "../../../lib/one-at-a-time.ts";

type Row = Record<string, unknown>;
export const sourceOf = (threadId: string): string => `chat:${threadId}`;
export interface Granted { type: string; id: string; level: string }

const warn = (ctx: ChatCtx, what: string, e: unknown, attrs: Record<string, unknown>): void =>
  ctx.log.warn(what, { ...attrs, error: e instanceof Error ? e.message.slice(0, 200) : String((e as { error?: { code?: string } } | null)?.error?.code ?? e) });

/** The agents these chats made for themselves and still hold. */
export function ownedIn(ctx: ChatCtx, threads: readonly string[]): string[] {
  ensure(ctx.db);
  if (threads.length === 0) return [];
  const marks = threads.map(() => "?").join(", ");
  return [...new Set((ctx.db.all(`SELECT "agentId" FROM chat_thread_agent WHERE "thread" IN (${marks}) AND "owned" = 1 AND "deleted_at" IS NULL`, ...threads) as Row[]).map((r) => String(r["agentId"])))];
}

/** Move the agents these chats made to Trash (or back out of it). Answers how many moved. */
export async function trashOwned(ctx: ChatCtx, agents: readonly string[], back = false): Promise<number> {
  if (!ctx.call) return 0;
  let n = 0;
  for (const agentId of agents) {
    try { await ctx.call(back ? "agents.restore" : "agents.delete", { agentId }); n += 1; } catch (e) { warn(ctx, back ? "a chat's own agent could not be restored" : "a chat's own agent could not be moved to Trash", e, { agentId }); }
  }
  return n;
}

export function grantsOf(ctx: ChatCtx, threadId: string, agentId: string): Granted[] {
  ensure(ctx.db);
  const raw = (ctx.db.all(`SELECT "grants" FROM chat_thread_agent WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`, threadId, agentId) as Row[])[0]?.["grants"];
  try { const v = JSON.parse(String(raw ?? "[]")) as unknown; return Array.isArray(v) ? (v as Granted[]) : []; } catch { return []; }
}

/** Take back every grant the chat gave this agent, each by its source tag. A failure stops the removal and is said: access never stays behind in silence. Answers how many grants went. */
export async function revokeGrants(ctx: ChatCtx, threadId: string, agentId: string, granted: readonly Granted[]): Promise<number> {
  if (!ctx.call) return 0;
  let revoked = 0;
  for (const g of granted) {
    try {
      const r = (await ctx.call("access.unshare", { resource: { type: g.type, id: g.id }, subject: { kind: "agent", id: agentId }, source: sourceOf(threadId) })) as { revoked?: number } | null;
      revoked += Number(r?.revoked ?? 0);
    } catch (e) { warn(ctx, "a grant given to an outside agent could not be taken back", e, { threadId, agentId, resource: `${g.type}:${g.id}` }); throw e; }
  }
  return revoked;
}

// ---- who sees an agent a chat made for itself (owner ruling, 4 Nov 2026) -----------------------------------------------------------------------------------
// An agent follows grants, so the chat grants it: everyone who can read the chat can see it, chat with it and poke it, whoever made it. A person who joins gets the grant, a person who leaves loses it.
// Each grant carries the source tag chat:<threadId>, so taking it back never touches a share someone made by hand. A grant that cannot be made is said in the log and the chat goes on.

type Subject = { kind: "person" | "group"; id: string };

async function grant(ctx: ChatCtx, threadId: string, agentId: string, subject: Subject): Promise<void> {
  if (!ctx.call) return;
  try {
    await ctx.call("access.share", { resource: { type: "agent", id: agentId }, subject, level: "view", source: sourceOf(threadId), idempotencyKey: `own:${threadId}:${agentId}:${subject.id}` }, { idempotencyKey: `own:${threadId}:${agentId}:${subject.id}` });
  } catch (e) { warn(ctx, "a chat's own agent could not be shown to a reader of the chat", e, { threadId, agentId, subject: subject.id }); }
}

// A person's grants from chats are written and taken back in one queue per person (lib/one-at-a-time.ts): a grant still being written for a newcomer can never land after the same person was
// taken out, because the removal waits for it and then takes it back, and a grant planned after the removal checks the membership first and finds it gone.
const queueOf = (ctx: ChatCtx, person: string): string => `chat:${ctx.space}:${person}`;

/** A new chat agent: shown to each of these readers (a public channel's is the whole Space). `still` says whether a person reader still reads the chat when their grant is written. */
export async function shareOwnedWithReaders(ctx: ChatCtx, threadId: string, agentId: string, readers: readonly Subject[], still: (person: string) => boolean = () => true): Promise<void> {
  for (const s of readers) {
    if (s.kind !== "person") { await grant(ctx, threadId, agentId, s); continue; }
    await oneAtATime(queueOf(ctx, s.id), async () => { if (still(s.id)) await grant(ctx, threadId, agentId, s); });
  }
}

/** A person joined the chat: every agent the chat made for itself is shown to them, while they are still in it. */
export async function shareOwnedWith(ctx: ChatCtx, threadId: string, person: string): Promise<void> {
  await oneAtATime(queueOf(ctx, person), async () => {
    for (const agentId of ownedIn(ctx, [threadId])) {
      if (!isMember(ctx.db, threadId, person)) return;
      await grant(ctx, threadId, agentId, { kind: "person", id: person });
    }
  });
}

/** A thread and the threads under it (a channel's main thread and its threads), to the depth threads nest. */
export function familyOf(ctx: ChatCtx, root: string): string[] {
  ensure(ctx.db);
  const out = [root];
  let level = [root];
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of level) for (const r of ctx.db.all(`SELECT "id" FROM chat_thread WHERE "parentThreadId" = ?`, id) as Row[]) next.push(String(r["id"]));
    out.push(...next);
    level = next;
  }
  return [...new Set(out)];
}

/**
 * A person left these chats, or was taken out: what being in them gave (their view of the agents these chats made for themselves, each grant tagged with its chat) is taken back, and only then is
 * the membership dropped (`drop`), all in the person's queue. A grant that cannot be taken back fails the call and the person stays in, so access never stays behind in silence. A grant the person
 * holds for another reason (a direct share, another chat) carries another source and is not touched. Answers what `drop` answered.
 */
export async function unshareOwnedFrom(ctx: ChatCtx, threads: string | readonly string[], person: string, drop: () => boolean = () => true): Promise<boolean> {
  const list = typeof threads === "string" ? [threads] : threads;
  return oneAtATime(queueOf(ctx, person), async () => {
    if (ctx.call) {
      for (const threadId of list) for (const agentId of ownedIn(ctx, [threadId])) {
        try { await ctx.call("access.unshare", { resource: { type: "agent", id: agentId }, subject: { kind: "person", id: person }, source: sourceOf(threadId) }); }
        catch (e) { warn(ctx, "a chat's own agent could not be taken out of a leaver's sight", e, { threadId, agentId, subject: person }); throw e; }
      }
    }
    return drop();
  });
}
