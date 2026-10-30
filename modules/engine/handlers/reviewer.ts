// The reviewer seat of a chat (CHAT-DESIGN ruling 2): a chat can name a reviewer, an agent or a person, who checks the lead agent's work before it counts. After each completed lead turn the engine
// asks an agent reviewer in the chat itself, in one quiet line ("Asking Reviewer to check this"), by @mention so the reviewer runs and the others do not; for a person it makes a Review task.
// A turn that an agent caused (a reviewer's own verdict, a hand-off) is never reviewed again, so two agents cannot keep each other busy.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineEvent } from "../../../agent/src/turn-engine/types.ts";
import { actorOf, raise } from "../projections.ts";
import type { Db, EngineCtx } from "../projections.ts";

export type Reviewer = { kind: "agent" | "person"; id: string };

const TABLE = `CREATE TABLE IF NOT EXISTS engine_reviewer (thread_id TEXT PRIMARY KEY, kind TEXT NOT NULL, reviewer_id TEXT NOT NULL, by_principal TEXT NOT NULL, at INTEGER NOT NULL)`;
const ready = new WeakSet<object>();
function ensureTable(db: Db): void { if (!ready.has(db)) { db.run(TABLE); ready.add(db); } }

export function reviewerOf(db: Db, threadId: string): Reviewer | null {
  ensureTable(db);
  const r = (db.all("SELECT kind, reviewer_id FROM engine_reviewer WHERE thread_id = ?", threadId) as Array<{ kind: string; reviewer_id: string }>)[0];
  return r ? { kind: r.kind as Reviewer["kind"], id: r.reviewer_id } : null;
}

export async function reviewerGet(ctx: EngineCtx, input: { threadId: string }): Promise<{ reviewer: Reviewer | null }> {
  await ctx.call("threads.get", { threadId: input.threadId });   // not found, or not yours, is the pipeline's answer
  return { reviewer: reviewerOf(ctx.db, input.threadId) };
}

export async function reviewerSet(ctx: EngineCtx, input: { threadId: string; reviewer: Reviewer | null }): Promise<{ reviewer: Reviewer | null }> {
  ensureTable(ctx.db);
  const got = (await ctx.call("threads.get", { threadId: input.threadId })) as { thread: { agents: Array<{ agentId: string; mode: string }> } };
  const r = input.reviewer;
  if (r) {
    if (r.kind === "agent" && !r.id.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { id: r.id });
    if (r.kind === "person" && !r.id.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { id: r.id });
    if (got.thread.agents.some((a) => a.agentId === r.id && a.mode === "lead")) raise(ctx, "validation.bad_input", "The agent that leads the chat cannot review its own work.");
    // An agent reviewer listens in the chat: it runs only when asked.
    if (r.kind === "agent" && !got.thread.agents.some((a) => a.agentId === r.id)) await ctx.call("threads.add_agent", { threadId: input.threadId, agentId: r.id });
    ctx.db.run("INSERT OR REPLACE INTO engine_reviewer (thread_id, kind, reviewer_id, by_principal, at) VALUES (?, ?, ?, ?, ?)", input.threadId, r.kind, r.id, actorOf(ctx), ctx.now());
  } else ctx.db.run("DELETE FROM engine_reviewer WHERE thread_id = ?", input.threadId);
  ctx.emit("thread.reviewer_changed", input.threadId, { threadId: input.threadId, reviewer: r, by: actorOf(ctx) });
  return { reviewer: r };
}

export interface ReviewHost {
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  postAs?: (agentId: string, post: { actingFor?: string; threadId: string; body: string; blocks: Array<{ type: string; v: number; data: unknown }>; mentions: unknown[]; clientId: string }) => Promise<unknown>;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/** After a turn completes: ask the chat's reviewer to check the lead's work. Resolves to what it did, for the log and the tests. */
export async function reviewAfter(h: ReviewHost, db: Db, engine: TurnEngine, e: Extract<EngineEvent, { type: "turn.completed" }>, newId: () => string): Promise<"asked" | "task" | "skipped"> {
  const reviewer = reviewerOf(db, e.threadId);
  if (!reviewer) return "skipped";
  if (reviewer.kind === "agent" && reviewer.id === e.agentId) return "skipped";
  const lead = engine.agents(e.threadId).find((a) => a.mode === "lead");
  if (!lead || lead.id !== e.agentId) return "skipped";
  const turn = engine.turns(e.threadId).find((t) => t.id === e.turnId);
  if (!turn || turn.routine) return "skipped";
  // only work a person asked for is reviewed: a turn caused by an agent (a verdict, a hand-off) is not
  const caused = engine.queue(e.threadId).find((q) => q.qseq === turn.qseq)?.messageId ?? null;
  const cause = caused ? engine.messages(e.threadId).find((m) => m.id === caused) : undefined;
  if (cause && cause.author.kind === "agent") return "skipped";
  const asker = turn.asker;
  const names = (await h.call("access.principals.list", { limit: 500 }, asker).catch(() => ({ principals: [] }))) as { principals?: Array<{ id: string; name: string }> };
  const nameOf = (id: string): string => names.principals?.find((p) => p.id === id)?.name ?? (id.startsWith("agt_") ? "the reviewer" : "a teammate");
  if (reviewer.kind === "agent") {
    if (!h.postAs) return "skipped";
    await h.postAs(e.agentId, { actingFor: asker, threadId: e.threadId, body: `Asking ${nameOf(reviewer.id)} to check this.`, blocks: [], mentions: [{ kind: "agent", id: reviewer.id }], clientId: newId() });
    return "asked";
  }
  await h.call("tasks.create", {
    kind: "review", title: `Review ${nameOf(e.agentId)}'s work`, summary: `${nameOf(e.agentId)} finished a turn in a chat. Read it and approve it or ask for changes.`,
    assigned: { kind: "person", id: reviewer.id }, source: { kind: "chat", id: e.threadId }, idempotencyKey: `review:${e.turnId}`,
  }, asker);
  return "task";
}
