// Budgets of a tree of agent work (r42-runtime slice 6): a limit on a node holds for that node and everything under it. When what the tree has used reaches the limit, the work under it is paused at its next safe point, never cut
// mid-call, and the owner is told in Needs you with the two things they can do: raise the limit (it goes on) or stop it. Nothing stops silently.
// DECISION: a limit is checked when a node tells what a model call used. The call in flight is allowed to finish and is counted, so the tree can end a little over its limit; the number shown is what was really used.
// DECISION: a limit of money counts only what has a price (a provider that says nothing, or a plan with no per-token price, adds tokens and no money); a limit of tokens counts everything. Both may be set.
import { appendEvent } from "./node-log.ts";
import { clean } from "./projections.ts";
import type { RunsCtx } from "./projections.ts";
import { getNode, limited, moveNode, reached, subtreeOf } from "./node.ts";
import type { Budget, Node } from "./node.ts";

export type { Budget } from "./node.ts";
export { budgetOf, limited, reached } from "./node.ts";

const dollars = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const said = (r: { what: string; used: number; limit: number }): string =>
  r.what === "money"
    ? `${dollars(r.used)} of the ${dollars(r.limit)} it was given`
    : `${r.used.toLocaleString("en-US")} of the ${r.limit.toLocaleString("en-US")} tokens it was given`;

/**
 * After a node told what a call used: for every limit above it that is reached and not yet acted on, pause what runs under it at the next safe point (the engine pauses a turn after the call it is on) and tell the owner.
 * Once per limit value: raising it makes a new limit that can be reached again. Returns the nodes whose limit was acted on.
 */
export async function enforceBudgets(ctx: RunsCtx, from: Node): Promise<Node[]> {
  const acted: Node[] = [];
  for (const a of limited(ctx, from)) {
    const hit = reached(ctx.db, a);
    if (!hit) continue;
    const key = `budget:${a.id}:${hit.what}:${hit.limit}`;
    const w = appendEvent(ctx.db, {
      rootRun: a.rootRun,
      runId: a.id,
      at: ctx.now(),
      type: "budget",
      actor: "svc_host",
      key,
      payload: { ...hit, scope: a.id === a.rootRun ? "job" : "node" },
    });
    if (w.duplicate) continue;
    acted.push(a);
    const live = subtreeOf(ctx.db, a.id).filter(
      (x) => x.status === "running" && x.threadId !== undefined && x.whoId !== undefined && x.whoKind === "agent",
    );
    let held = 0;
    let stopped = 0;
    for (const x of live) {
      try {
        const r = (await ctx.call?.("engine.pause", {
          threadId: x.threadId,
          agentId: x.whoId,
          reason: "its limit",
        })) as { paused?: number; held?: number } | undefined;
        held += r?.held ?? 0;
        stopped += r?.paused ?? 0;
      } catch {
        appendEvent(ctx.db, {
          rootRun: a.rootRun,
          runId: x.id,
          at: ctx.now(),
          type: "budget",
          actor: "svc_host",
          key: `budget-pause-failed:${x.id}:${hit.limit}`,
          payload: { problem: "pause_failed" },
        });
      }
    }
    try {
      await ctx.call?.(
        "tasks.create",
        clean({
          kind: "unblock",
          title: `${a.name ?? "A job"} reached its limit`,
          summary: `It used ${said(hit)}. ${held > 0 ? `${stopped > 0 ? "Some of it is paused where it can go on from; the rest is" : "It is"} held at its next step.` : "It is paused where it can go on from."}`,
          why: "Raise the limit to let it go on, or stop it.",
          assigned: { kind: "person", id: a.owner },
          source: { kind: "run", id: a.id },
          idempotencyKey: key,
        }),
      );
    } catch {
      /* the pause and the event stand; Needs you catches up through them */
    }
  }
  return acted;
}

/** Nodes of a tree that a limit paused (they wait as paused, with the work they did kept) under a node. */
export const pausedUnder = (ctx: RunsCtx, id: string): Node[] =>
  subtreeOf(ctx.db, id).filter((x) => x.status === "paused" && x.threadId !== undefined && x.whoId !== undefined);

/** Raise or clear the limit of a node, and go on with what it paused if the tree is now under it. Returns how many turns were started again. */
export async function setBudget(ctx: RunsCtx, id: string, b: Budget | null): Promise<{ node: Node; resumed: number }> {
  const n = getNode(ctx, id);
  ctx.db.run(
    "UPDATE runs_node SET budget_json = ?, updated_at = ? WHERE run_id = ?",
    b === null || (b.usdMicros === undefined && b.tokens === undefined) ? null : JSON.stringify(b),
    ctx.now(),
    id,
  );
  appendEvent(ctx.db, {
    rootRun: n.rootRun,
    runId: id,
    at: ctx.now(),
    type: "budget",
    actor: ctx.principal.id,
    payload: { set: b },
  });
  const now = getNode(ctx, id);
  let resumed = 0;
  if (!reached(ctx.db, now)) {
    // no limit above the work it paused or held is still reached: it goes on
    for (const x of subtreeOf(ctx.db, id)) {
      if (x.status !== "paused" && x.status !== "running") continue;
      if (limited(ctx, x).some((a) => reached(ctx.db, a))) continue;
      const engineBacked = x.threadId !== undefined && x.whoId !== undefined && x.whoKind === "agent";
      if (!engineBacked) {
        // work with no engine behind it that was held back from starting under the limit simply goes back in the queue
        if (x.status === "paused") {
          try {
            moveNode(ctx, x.id, "queued", { why: "resumed", by: ctx.principal.id });
            resumed += 1;
          } catch {
            /* moved by someone else meanwhile */
          }
        }
        continue;
      }
      try {
        // a paused turn starts again as a turn of its own; a turn held at its next call is let go (it was never stopped)
        const r = (await ctx.call?.("engine.resume_paused", { threadId: x.threadId, agentId: x.whoId })) as
          { resumed?: number; released?: number } | undefined;
        resumed += (r?.resumed ?? 0) + (r?.released ?? 0);
        if (x.status === "paused") {
          // the turn goes on as a turn of its own (its own node); the one that waited has done its part
          ctx.db.run(
            "UPDATE runs_node SET status = 'stopped', stop_reason = 'resumed', version = version + 1, ended_at = ?, updated_at = ? WHERE run_id = ? AND status = 'paused'",
            ctx.now(),
            ctx.now(),
            x.id,
          );
          appendEvent(ctx.db, {
            rootRun: x.rootRun,
            runId: x.id,
            at: ctx.now(),
            type: "state",
            actor: ctx.principal.id,
            key: `resumed:${x.id}`,
            payload: { from: "paused", to: "stopped", why: "resumed" },
          });
        }
      } catch {
        /* it stays as it was; the person can try again */
      }
    }
  }
  return { node: now, resumed };
}

/** Does any work under this node spend the Space's money, or not yet say whose it spends? Unknown is treated as the Space's: the safe side for money. */
export const spendsSpace = (ctx: RunsCtx, id: string): boolean =>
  subtreeOf(ctx.db, id).some((x) => x.spendScope !== "own");

/** Is this change a raise: a limit made bigger, or taken away (a dimension that had a limit and has none)? Setting the first limit, or lowering one, only reduces what can be spent. */
export function isRaise(prev: Budget, next: Budget | null): boolean {
  if (prev.usdMicros === undefined && prev.tokens === undefined) return false;
  if (next === null) return true;
  const more = (a: number | undefined, b: number | undefined): boolean => a !== undefined && (b === undefined || b > a);
  return more(prev.usdMicros, next.usdMicros) || more(prev.tokens, next.tokens);
}
