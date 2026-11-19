// Run node capabilities (r42-runtime): the tree of agent work. The writes that make and move nodes are system calls (the engine, chat, terminal and the host's sweep); a person's own handle on a node is
// runs.node.control (pause, resume, stop) and the three reads. Who may see a tree: whoever may see its root (its owner, who started it, a Manage holder).
import { isSystemCall } from "../../../lib/trust.ts";
import { stop } from "./engine.ts";
import { canSee, mayManage, raise } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";
import {
  beatNode,
  claimNode,
  eventsSince,
  findNode,
  getNode,
  moveNode,
  pauseSubtree,
  reclaimExpired,
  resumeSubtree,
  startNode,
  stopSubtree,
  subtreeOf,
  subtreeSpent,
  treeNodes,
  writeEvent,
} from "../node.ts";
import type { Node, NodeStatus, StartInput, Why } from "../node.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A node as the contract says it: the checkpoint and the policy stay inside; the rest goes out. */
export function nodeOut(n: Node): Record<string, unknown> {
  const { checkpoint: _c, policy: _p, idemKey: _i, heartbeatAt: _h, ...rest } = n;
  void _c;
  void _p;
  void _i;
  void _h;
  return rest as Record<string, unknown>;
}

const systemOnly = (ctx: RunsCtx): void => {
  if (!isSystemCall(ctx as Parameters<typeof isSystemCall>[0]))
    raise(ctx, "permission.no_grant", "That is for the server, not for a person.", { reason: "system_call" });
};
const seeNode = (ctx: RunsCtx, id: string): Node => {
  const n = getNode(ctx, id);
  const root = n.id === n.rootRun ? n : (findNode(ctx.db, n.rootRun) ?? n);
  if (!canSee(ctx, { id: root.id, owner: root.owner, startedBy: root.startedBy }))
    raise(ctx, "permission.not_found", "That run is not available.");
  return n;
};
const manageNode = (ctx: RunsCtx, id: string): Node => {
  const n = seeNode(ctx, id);
  if (!mayManage(ctx, { id: n.id, owner: n.owner }))
    raise(ctx, "permission.role_lacks_permission", "Only the owner or someone who manages runs can do that.", {
      reason: "manage_required",
    });
  return n;
};

export async function nodeStart(ctx: RunsCtx, input: In): Promise<unknown> {
  systemOnly(ctx);
  const { node, created } = startNode(ctx, input as StartInput);
  return { node: nodeOut(node), created };
}
export async function nodeMove(ctx: RunsCtx, input: In): Promise<unknown> {
  systemOnly(ctx);
  const { node, changed } = moveNode(ctx, input.runId, input.to as NodeStatus, {
    why: input.why as Why,
    expectedVersion: input.expectedVersion,
    expectedFrom: input.expectedFrom,
    summary: input.summary,
    result: input.result,
    evidence: input.evidence,
    error: input.error,
    stopReason: input.stopReason,
    wake: input.wake,
    checkpoint: input.checkpoint,
  });
  return { node: nodeOut(node), changed };
}
export async function nodeEvent(ctx: RunsCtx, input: In): Promise<unknown> {
  systemOnly(ctx);
  return writeEvent(ctx, input.runId, {
    type: input.type,
    key: input.key,
    actor: input.actor ?? ctx.principal.id,
    payload: input.payload,
    at: input.at,
  });
}
export async function nodeClaim(ctx: RunsCtx, input: In): Promise<unknown> {
  systemOnly(ctx);
  const n = claimNode(ctx, input.runId, input.holder);
  return n ? { node: nodeOut(n) } : {};
}
export async function nodeBeat(ctx: RunsCtx, input: In): Promise<unknown> {
  systemOnly(ctx);
  return { held: beatNode(ctx, input.runId, input.holder) };
}
export async function nodeReclaim(ctx: RunsCtx): Promise<unknown> {
  systemOnly(ctx);
  return { reclaimed: reclaimExpired(ctx).map((n) => n.id) };
}

export async function nodeControl(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = manageNode(ctx, input.runId);
  // a node that mirrors a flow Run (a routine, a wait, a terminal Run) belongs to the Run engine: stop goes through it, and it cannot be paused
  if ((n.origin as { mirror?: string } | undefined)?.mirror === "run") {
    if (input.action !== "stop")
      raise(ctx, "validation.precondition_failed", "That one cannot be paused. Stop it instead.", {
        reason: "not_pausable",
      });
    await stop(ctx, { runId: n.id, reason: input.reason });
    return { nodes: [nodeOut(getNode(ctx, n.id))] };
  }
  const by = ctx.principal.id;
  const reason = typeof input.reason === "string" && input.reason !== "" ? input.reason : undefined;
  let moved: Node[];
  if (input.action === "stop") {
    if (n.status === "stopped") moved = [n];
    else if (n.status === "succeeded" || n.status === "failed")
      raise(ctx, "validation.precondition_failed", "That run has already finished.", {
        reason: "run_finished",
        status: n.status,
      });
    else
      moved =
        input.subtree === false
          ? [moveNode(ctx, n.id, "stopped", { why: "stopped", stopReason: reason, by }).node]
          : stopSubtree(ctx, n.id, reason, by);
  } else if (input.action === "pause") {
    if (n.status === "paused") moved = [n];
    else if (n.status === "succeeded" || n.status === "failed" || n.status === "stopped")
      raise(ctx, "validation.precondition_failed", "That run has already finished.", {
        reason: "run_finished",
        status: n.status,
      });
    else
      moved =
        input.subtree === false
          ? [moveNode(ctx, n.id, "paused", { why: "paused", by }).node]
          : pauseSubtree(ctx, n.id, by);
  } else {
    if (n.status !== "paused")
      raise(ctx, "validation.precondition_failed", "That run is not paused.", {
        reason: "not_paused",
        status: n.status,
      });
    moved =
      input.subtree === false
        ? [moveNode(ctx, n.id, "queued", { why: "resumed", by }).node]
        : resumeSubtree(ctx, n.id, by);
  }
  return { nodes: moved.map(nodeOut) };
}

export async function nodeGet(ctx: RunsCtx, input: In): Promise<unknown> {
  return { node: nodeOut(seeNode(ctx, input.runId)) };
}
export async function treeGet(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = seeNode(ctx, input.runId);
  const nodes = n.id === n.rootRun ? treeNodes(ctx.db, n.rootRun) : subtreeOf(ctx.db, n.id);
  const last = eventsSince(ctx.db, n.rootRun, 0, 1).length === 0 ? 0 : lastSeq(ctx, n.rootRun);
  return { nodes: nodes.map(nodeOut), spent: subtreeSpent(ctx.db, n.id), lastSeq: last };
}
const lastSeq = (ctx: RunsCtx, root: string): number =>
  Number(
    (ctx.db.all("SELECT COALESCE(MAX(seq), 0) AS m FROM runs_event WHERE root_run = ?", root) as { m: number }[])[0]
      ?.m ?? 0,
  );
export async function eventsList(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = seeNode(ctx, input.runId);
  const events = eventsSince(ctx.db, n.rootRun, input.since ?? 0, input.limit ?? 200, input.only);
  return { events, lastSeq: events.length > 0 ? events[events.length - 1]!.seq : (input.since ?? 0) };
}

/** The host's sweep, every few seconds: nodes whose worker stopped beating go back to the queue with the next attempt. */
export const NODE_SWEEP_MS = 5_000;
export function nodeSweep(ctx: RunsCtx): void {
  reclaimExpired(ctx);
}
