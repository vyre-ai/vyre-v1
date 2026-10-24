// Queue, lease, route preview and engine health (ARCH 6.1, 6.2, 6.5; spec 2.5):
//   engine.lease.acquire/heartbeat/release, engine.queue.list/peek, engine.route.preview, engine.health.
// The lease and queue rows are the same SQL the in-process turn engine uses (projections.sqlLeases, sqlQueue), so a second host sees what the first one holds.
import { LEASE_TTL_MS } from "../../../../agent/src/turn-engine/lease.ts";
import { preview } from "../../../../agent/src/turn-engine/lead.ts";
import type { RouteMention } from "../../../../lib/route.ts";
import { actorOf, raise, sqlLeases, sqlQueue } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { ensureExtra } from "./schema.ts";
import { num, optStr, rows, str } from "./util.ts";

// ---- lease

export function leaseAcquire(ctx: EngineCtx, input: { threadId: string; holder: string; kind: "turn" | "wait" }): { acquired: boolean; expiresAt: number } {
  ensureExtra(ctx.db);
  if (input.holder.trim() === "") raise(ctx, "validation.bad_input", "Name the holder, like host:<space> or device:<id>.", { field: "holder" });
  const leases = sqlLeases(ctx.db);
  const got = leases.acquire(input.threadId, input.holder, ctx.now());
  if (got) return { acquired: true, expiresAt: got.expiresAt };
  // Someone else holds it: say until when, so the caller can try again then.
  const cur = leases.get(input.threadId, ctx.now());
  return { acquired: false, expiresAt: cur ? cur.expiresAt : ctx.now() + LEASE_TTL_MS };
}

export function leaseHeartbeat(ctx: EngineCtx, input: { threadId: string; holder: string }): { expiresAt: number } {
  ensureExtra(ctx.db);
  const leases = sqlLeases(ctx.db);
  if (!leases.renew(input.threadId, input.holder, ctx.now())) {
    raise(ctx, "validation.precondition_failed", "This holder no longer has the thread. Stop the turn.", { threadId: input.threadId, holder: input.holder });
  }
  const cur = leases.get(input.threadId, ctx.now());
  return { expiresAt: cur ? cur.expiresAt : ctx.now() + LEASE_TTL_MS };
}

export function leaseRelease(ctx: EngineCtx, input: { threadId: string; holder: string }): { ok: boolean } {
  ensureExtra(ctx.db);
  sqlLeases(ctx.db).release(input.threadId, input.holder);
  return { ok: true };
}

// ---- queue

export function queueList(ctx: EngineCtx, input: { threadId: string }): {
  items: Array<{ qseq: number; kind: "message" | "interrupt" | "wake" | "handoff"; messageId?: string; from: string; priority: number; state: string }>;
} {
  ensureExtra(ctx.db);
  const r = rows(ctx, "SELECT * FROM engine_thread_queue WHERE thread_id = ? AND state IN ('queued', 'running') ORDER BY priority DESC, qseq ASC", input.threadId);
  return {
    items: r.map((x) => {
      const messageId = optStr(x["message_id"]);
      return {
        qseq: num(x["qseq"]), kind: str(x["kind"]) as "message" | "interrupt" | "wake" | "handoff", ...(messageId === undefined ? {} : { messageId }),
        from: str(x["from_principal"]), priority: num(x["priority"]), state: str(x["state"]),
      };
    }),
  };
}

/** The steering check between tool calls: messages that arrived while a turn runs and may be injected at the next step, oldest first. */
export function queuePeek(ctx: EngineCtx, input: { threadId: string }): { messages: string[] } {
  ensureExtra(ctx.db);
  const r = rows(ctx, "SELECT message_id FROM engine_thread_queue WHERE thread_id = ? AND state = 'queued' AND steer = 1 AND kind = 'message' AND message_id IS NOT NULL ORDER BY qseq ASC", input.threadId);
  return { messages: r.map((x) => str(x["message_id"])) };
}

// ---- route preview

interface ThreadOut { thread: { agents: Array<{ agentId: string; mode: "lead" | "listen"; name?: string }> } }

/** The composer line, from the same route() the server uses to enqueue. A draft is a person's message. */
export async function routePreview(ctx: EngineCtx, input: { threadId: string; mentions?: RouteMention[] }): Promise<{ responders: string[]; line: string }> {
  let out: ThreadOut;
  try {
    out = (await ctx.call("threads.get", { threadId: input.threadId })) as ThreadOut;
  } catch {
    raise(ctx, "validation.not_found", "There is no such conversation.", { threadId: input.threadId });
  }
  const agents = out.thread.agents.map((a) => ({ id: a.agentId, mode: a.mode, ...(a.name === undefined ? {} : { name: a.name }) }));
  const res = preview(agents, { kind: "person", id: actorOf(ctx) }, input.mentions ?? [], 0);
  return { responders: res.responders, line: res.line === "" ? "No agent will reply, type @ to ask one" : res.line };
}

// ---- health

/** A queued turn older than this means the worker is behind; older than DOWN_MS means it is not running. */
export const DEGRADED_MS = 60_000;
export const DOWN_MS = 300_000;

export function engineHealth(ctx: EngineCtx, _input: Record<string, never>): { state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number; oldestQueuedMs: number } {
  ensureExtra(ctx.db);
  const now = ctx.now();
  const oldest = rows(ctx, "SELECT MIN(enqueued_at) AS at FROM engine_thread_queue WHERE state = 'queued'")[0]?.["at"];
  const oldestQueuedMs = oldest === null || oldest === undefined ? 0 : Math.max(0, now - num(oldest));
  // A turn marked running whose lease is gone belongs to a dead worker; recover() on its thread requeues it.
  const orphans = num(rows(
    ctx,
    `SELECT COUNT(*) AS n FROM engine_thread_queue q WHERE q.state = 'running'
       AND NOT EXISTS (SELECT 1 FROM engine_thread_lease l WHERE l.thread_id = q.thread_id AND l.expires_at > ?)`, now,
  )[0]?.["n"]);
  if (oldestQueuedMs >= DOWN_MS) return { state: "down", detail: `The oldest waiting turn has waited ${Math.round(oldestQueuedMs / 1000)} seconds.`, oldestQueuedMs };
  if (oldestQueuedMs >= DEGRADED_MS) return { state: "degraded", detail: `The oldest waiting turn has waited ${Math.round(oldestQueuedMs / 1000)} seconds.`, oldestQueuedMs };
  if (orphans > 0) return { state: "degraded", detail: `${orphans} running ${orphans === 1 ? "turn has" : "turns have"} no worker.`, oldestQueuedMs };
  return { state: "healthy", oldestQueuedMs };
}
