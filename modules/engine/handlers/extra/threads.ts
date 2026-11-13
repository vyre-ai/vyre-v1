// Queue, lease, route preview and engine health (ARCH 6.1, 6.2, 6.5; spec 2.5):
//   engine.lease.acquire/heartbeat/release, engine.queue.list/peek, engine.route.preview, engine.health.
// The lease and queue rows are the same SQL the in-process turn engine uses (projections.sqlLeases, sqlQueue), so a second host sees what the first one holds.
import { LEASE_TTL_MS } from "../../../../agent/src/turn-engine/lease.ts";
import { preview } from "../../../../agent/src/turn-engine/lead.ts";
import type { RouteMention } from "../../../../lib/route.ts";
import { actorOf, ensure, raise, sqlLeases } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { ensureExtra } from "./schema.ts";
import { num, optStr, rows, str } from "./util.ts";

// ---- lease

export function leaseAcquire(
  ctx: EngineCtx,
  input: { threadId: string; holder: string; kind: "turn" | "wait" },
): { acquired: boolean; expiresAt: number } {
  ensureExtra(ctx.db);
  if (input.holder.trim() === "")
    raise(ctx, "validation.bad_input", "Name the holder, like host:<space> or device:<id>.", { field: "holder" });
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
    raise(ctx, "validation.precondition_failed", "This holder no longer has the chat. Stop the turn.", {
      threadId: input.threadId,
      holder: input.holder,
    });
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

export function queueList(
  ctx: EngineCtx,
  input: { threadId: string },
): {
  items: Array<{
    qseq: number;
    kind: "message" | "interrupt" | "wake" | "handoff";
    messageId?: string;
    from: string;
    priority: number;
    state: string;
  }>;
} {
  ensureExtra(ctx.db);
  const r = rows(
    ctx,
    "SELECT * FROM engine_thread_queue WHERE thread_id = ? AND state IN ('queued', 'running') ORDER BY priority DESC, qseq ASC",
    input.threadId,
  );
  return {
    items: r.map((x) => {
      const messageId = optStr(x["message_id"]);
      return {
        qseq: num(x["qseq"]),
        kind: str(x["kind"]) as "message" | "interrupt" | "wake" | "handoff",
        ...(messageId === undefined ? {} : { messageId }),
        from: str(x["from_principal"]),
        priority: num(x["priority"]),
        state: str(x["state"]),
      };
    }),
  };
}

/** The steering check between tool calls: messages that arrived while a turn runs and may be injected at the next step, oldest first. */
export function queuePeek(ctx: EngineCtx, input: { threadId: string }): { messages: string[] } {
  ensureExtra(ctx.db);
  const r = rows(
    ctx,
    "SELECT message_id FROM engine_thread_queue WHERE thread_id = ? AND state = 'queued' AND steer = 1 AND kind = 'message' AND message_id IS NOT NULL ORDER BY qseq ASC",
    input.threadId,
  );
  return { messages: r.map((x) => str(x["message_id"])) };
}

/**
 * Who asked for the turn that is making this call (engine.turn.asked_by): the running turn of the calling agent in the calling chat, read from the queue and the message mirror the turn engine writes.
 * System use only: a module's own nested call, never a call from outside, and the answer never depends on anything the agent sent. `askedBy` is set only when the turn is not a routine and a person's own
 * message started it (kind message or interrupt, authored by that person) or was added while it ran (steering, consumed after it began). An agent's message, a Job line, a wake, a hand-off and a
 * watcher's turn never count. No running turn for this agent in this chat answers "none": nobody asked.
 */
export function turnAskedBy(
  ctx: EngineCtx,
  _input: Record<string, never>,
): {
  kind: "message" | "interrupt" | "wake" | "handoff" | "none";
  routine: boolean;
  askedBy?: { person: string; messageIds: string[]; at: number };
} {
  ensure(ctx.db);
  ensureExtra(ctx.db);
  if ((ctx.depth ?? 0) < 1 || ctx.forwarded === true)
    raise(ctx, "permission.role_lacks_permission", "Only the server asks this.", { reason: "system_only" });
  if (ctx.principal.kind !== "agent" || !ctx.thread) return { kind: "none", routine: false };
  const run = rows(
    ctx,
    "SELECT * FROM engine_thread_queue WHERE thread_id = ? AND agent_id = ? AND state IN ('running', 'stopping') ORDER BY qseq DESC LIMIT 1",
    ctx.thread,
    ctx.principal.id,
  )[0];
  if (!run) return { kind: "none", routine: false };
  const kind = str(run["kind"]) as "message" | "interrupt" | "wake" | "handoff",
    routine = Number(run["routine"]) === 1;
  if (routine || (kind !== "message" && kind !== "interrupt")) return { kind, routine };
  // the row that started the turn, then the person's steering messages that were taken into it afterwards
  const ids = [
    optStr(run["message_id"]),
    ...rows(
      ctx,
      "SELECT message_id FROM engine_thread_queue WHERE thread_id = ? AND agent_id = ? AND state = 'consumed' AND steer = 1 AND kind = 'message' AND qseq > ? AND message_id IS NOT NULL ORDER BY qseq ASC",
      ctx.thread,
      ctx.principal.id,
      num(run["qseq"]),
    ).map((r) => optStr(r["message_id"])),
  ];
  const mine: Array<{ id: string; at: number }> = [];
  let person: string | undefined;
  for (const id of ids) {
    if (!id) continue;
    const m = rows(
      ctx,
      "SELECT author_kind, author_id, at FROM engine_messages WHERE id = ? AND thread_id = ?",
      id,
      ctx.thread,
    )[0];
    if (!m || str(m["author_kind"]) !== "person") continue;
    // typed by the person themselves (the flag the Gate trusts); a poke, a helper's restart line or any line posted in their name is not
    if (rows(ctx, "SELECT 1 AS x FROM engine_typed_message WHERE message_id = ?", id).length === 0) continue;
    if (person !== undefined && person !== str(m["author_id"])) continue;
    person = str(m["author_id"]);
    mine.push({ id, at: num(m["at"]) });
  }
  // the message that started the turn must itself be a person's: a turn an agent's message started is not asked for, whoever speaks for whom
  const first = ids[0] ? mine.find((m) => m.id === ids[0]) : undefined;
  if (!first || person === undefined || str(run["from_principal"]) !== person) return { kind, routine };
  return {
    kind,
    routine,
    askedBy: { person, messageIds: mine.map((m) => m.id), at: Math.max(...mine.map((m) => m.at)) },
  };
}

// ---- route preview

interface ThreadOut {
  thread: {
    kind?: string;
    scopeType?: string;
    members?: Array<{ kind?: string; id: string }>;
    agents: Array<{ agentId: string; mode: "lead" | "listen"; name?: string }>;
  };
}

/** The composer line, from the same route() the server uses to enqueue. A draft is a person's message. */
export async function routePreview(
  ctx: EngineCtx,
  input: { threadId: string; mentions?: RouteMention[]; text?: string },
): Promise<{ responders: string[]; line: string }> {
  let out: ThreadOut;
  try {
    out = (await ctx.call("threads.get", { threadId: input.threadId })) as ThreadOut;
  } catch {
    raise(ctx, "validation.not_found", "There is no such conversation.", { threadId: input.threadId });
  }
  const agents = out.thread.agents.map((a) => ({
    id: a.agentId,
    mode: a.mode,
    ...(a.name === undefined ? {} : { name: a.name }),
  }));
  const people = out.thread.members?.filter((x) => (x.kind ?? "person") === "person").map((x) => x.id);
  const res = preview(
    agents,
    { kind: "person", id: actorOf(ctx) },
    input.mentions ?? [],
    0,
    {},
    {
      ...(out.thread.kind ? { kind: out.thread.kind } : {}),
      ...(["task", "note", "goal"].includes(out.thread.scopeType ?? "") ? { personal: true } : {}),
      ...(people ? { people } : {}),
    },
    input.text,
  );
  if (res.reason === "person_addressed") {
    const lead = agents.find((a) => a.mode === "lead");
    return {
      responders: [],
      line: `Goes to the person you named; no agent will reply${lead?.name ? `. Ask ${lead.name} too` : ""}`,
    };
  }
  return { responders: res.responders, line: res.line === "" ? "No agent will reply. @mention one" : res.line };
}

// ---- health

/** A queued turn older than this means the worker is behind; older than DOWN_MS means it is not running. */
export const DEGRADED_MS = 60_000;
export const DOWN_MS = 300_000;

export function engineHealth(
  ctx: EngineCtx,
  _input: Record<string, never>,
): { state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number; oldestQueuedMs: number } {
  ensureExtra(ctx.db);
  const now = ctx.now();
  const oldest = rows(ctx, "SELECT MIN(enqueued_at) AS at FROM engine_thread_queue WHERE state = 'queued'")[0]?.["at"];
  const oldestQueuedMs = oldest === null || oldest === undefined ? 0 : Math.max(0, now - num(oldest));
  // A turn marked running whose lease is gone belongs to a dead worker; recover() on its thread requeues it.
  const orphans = num(
    rows(
      ctx,
      `SELECT COUNT(*) AS n FROM engine_thread_queue q WHERE q.state = 'running'
       AND NOT EXISTS (SELECT 1 FROM engine_thread_lease l WHERE l.thread_id = q.thread_id AND l.expires_at > ?)`,
      now,
    )[0]?.["n"],
  );
  if (oldestQueuedMs >= DOWN_MS)
    return {
      state: "down",
      detail: `The oldest waiting turn has waited ${Math.round(oldestQueuedMs / 1000)} seconds.`,
      oldestQueuedMs,
    };
  if (oldestQueuedMs >= DEGRADED_MS)
    return {
      state: "degraded",
      detail: `The oldest waiting turn has waited ${Math.round(oldestQueuedMs / 1000)} seconds.`,
      oldestQueuedMs,
    };
  if (orphans > 0)
    return {
      state: "degraded",
      detail: `${orphans} running ${orphans === 1 ? "turn has" : "turns have"} no worker.`,
      oldestQueuedMs,
    };
  return { state: "healthy", oldestQueuedMs };
}
