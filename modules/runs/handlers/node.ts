// Run node capabilities (r42-runtime): the tree of agent work. The writes that make and move nodes are system calls (the engine, chat, terminal and the host's sweep); a person's own handle on a node is
// runs.node.control (pause, resume, stop) and the three reads. Who may see a tree: whoever may see its root (its owner, who started it, a Manage holder).
import { isSystemCall } from "../../../lib/trust.ts";
import { stop } from "./engine.ts";
import {
  boardAnswer,
  boardList,
  boardPut,
  markSeen,
  messageSend,
  messagesInTree,
  messagesOf,
  takeMessages,
} from "../board.ts";
import { canSee, mayManage, raise } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";
import {
  beatNode,
  claimNode,
  eventsSince,
  findNode,
  getNode,
  isTerminal,
  liveNodes,
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

/** Nodes an agent turn of the engine stands behind: a stop reaches the engine. */
const ENGINE_KINDS = new Set(["turn", "helper", "crew"]);
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
    else {
      // what really works behind a node is stopped first: an agent's turn through the engine's own Stop; only then does the node say stopped (a node that says stopped while its work goes on is worse than none)
      const scope = input.subtree === false ? [n] : subtreeOf(ctx.db, n.id);
      for (const x of scope) {
        if (isTerminal(x.status) || !ENGINE_KINDS.has(x.kind) || x.threadId === undefined || x.whoId === undefined)
          continue;
        if (!ctx.call)
          raise(ctx, "internal.unavailable", "That cannot be stopped from here right now.", { reason: "no_engine" });
        try {
          await ctx.call("engine.stop", { threadId: x.threadId, agentId: x.whoId });
        } catch {
          raise(ctx, "internal.unavailable", "It could not be stopped just now. Try again.", {
            reason: "stop_failed",
            runId: x.id,
          });
        }
      }
      moved =
        input.subtree === false
          ? [moveNode(ctx, n.id, "stopped", { why: "stopped", stopReason: reason, by }).node]
          : stopSubtree(ctx, n.id, reason, by);
    }
  } else if (input.action === "pause") {
    if (n.status === "paused") moved = [n];
    else if (n.status === "succeeded" || n.status === "failed" || n.status === "stopped")
      raise(ctx, "validation.precondition_failed", "That run has already finished.", {
        reason: "run_finished",
        status: n.status,
      });
    else
      // nothing behind a node holds still when it says paused yet (the turn engine has no pause), so a person is not offered one that does nothing; a budget limit pauses a node by its own rule when that lands
      raise(ctx, "validation.precondition_failed", "That one cannot be paused yet. Stop it instead.", {
        reason: "not_pausable",
      });
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

/**
 * Who sees what of a tree. The owner, the starter and anyone who manages runs see all of it. Another person in the chat the tree works in (they may view that chat) sees that work is going on and how far, and nothing of
 * what it was asked or found: no brief, words, result, evidence, names of who works, model or cost, and the helpers are "Helper 1", "Helper 2" (the F51 rule). Anyone else sees nothing. The server cuts it; no client does.
 */
function look(ctx: RunsCtx, id: string): { node: Node; full: boolean } {
  const n = getNode(ctx, id);
  const root = n.id === n.rootRun ? n : (findNode(ctx.db, n.rootRun) ?? n);
  if (canSee(ctx, { id: root.id, owner: root.owner, startedBy: root.startedBy })) return { node: n, full: true };
  const thread = root.threadId ?? n.threadId;
  if (
    thread !== undefined &&
    ctx.authorize?.({ perm: null, level: "view" }, { type: "thread", id: thread }).effect === "allow"
  )
    return { node: n, full: false };
  return raise(ctx, "permission.not_found", "That run is not available.");
}

const WORKERS = new Set(["helper", "crew", "subagent"]);
/** "Helper 3": the order a kind of worker was started in its tree. */
function labelsOf(nodes: readonly Node[]): Map<string, string> {
  const out = new Map<string, string>();
  let helpers = 0;
  for (const n of nodes) {
    if (WORKERS.has(n.kind)) out.set(n.id, `Helper ${++helpers}`);
    else if (n.kind === "turn") out.set(n.id, "A reply");
    else out.set(n.id, n.kind === "terminal" ? "A command" : n.kind === "wait" ? "Waiting" : "Work");
  }
  return out;
}
export function redactedOut(n: Node, label: string): Record<string, unknown> {
  return {
    id: n.id,
    rootRun: n.rootRun,
    ...(n.parentRun === undefined ? {} : { parentRun: n.parentRun }),
    depth: n.depth,
    kind: n.kind,
    name: label,
    owner: n.owner,
    startedBy: n.startedBy,
    whoKind: n.whoKind,
    status: n.status,
    version: n.version,
    attempt: n.attempt,
    spent: { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0, calls: 0 },
    ...(n.wake
      ? {
          wake: {
            kind: n.wake.kind,
            ...(n.wake.dueAt === undefined ? {} : { dueAt: n.wake.dueAt }),
            ...(n.wake.wokeCount === undefined ? {} : { wokeCount: n.wake.wokeCount }),
          },
        }
      : {}),
    startedAt: n.startedAt,
    ...(n.endedAt === undefined ? {} : { endedAt: n.endedAt }),
    updatedAt: n.updatedAt,
  };
}

export async function nodeGet(ctx: RunsCtx, input: In): Promise<unknown> {
  const { node, full } = look(ctx, input.runId);
  if (full) return { node: nodeOut(node) };
  const labels = labelsOf(treeNodes(ctx.db, node.rootRun));
  return { node: redactedOut(node, labels.get(node.id) ?? "Work") };
}
export async function treeGet(ctx: RunsCtx, input: In): Promise<unknown> {
  const { node: n, full } = look(ctx, input.runId);
  const all = treeNodes(ctx.db, n.rootRun);
  const nodes = n.id === n.rootRun ? all : subtreeOf(ctx.db, n.id);
  const last = lastSeq(ctx, n.rootRun);
  if (full) return { nodes: nodes.map(nodeOut), spent: subtreeSpent(ctx.db, n.id), lastSeq: last };
  const labels = labelsOf(all);
  return {
    nodes: nodes.map((x) => redactedOut(x, labels.get(x.id) ?? "Work")),
    spent: { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0, calls: 0 },
    lastSeq: last,
  };
}
const lastSeq = (ctx: RunsCtx, root: string): number =>
  Number(
    (ctx.db.all("SELECT COALESCE(MAX(seq), 0) AS m FROM runs_event WHERE root_run = ?", root) as { m: number }[])[0]
      ?.m ?? 0,
  );
export async function eventsList(ctx: RunsCtx, input: In): Promise<unknown> {
  const { node: n, full } = look(ctx, input.runId);
  const raw = eventsSince(ctx.db, n.rootRun, input.since ?? 0, input.limit ?? 200, input.only);
  const cursor = raw.length > 0 ? raw[raw.length - 1]!.seq : (input.since ?? 0);
  if (full) return { events: raw, lastSeq: cursor };
  // a person who may only see that work goes on gets the state changes and when, nothing a node said, used or found
  const events = raw
    .filter((e) => e.type === "state")
    .map((e) => {
      const p = (e.payload ?? {}) as { from?: unknown; to?: unknown; why?: unknown };
      return {
        rootRun: e.rootRun,
        seq: e.seq,
        runId: e.runId,
        at: e.at,
        type: "state",
        payload: { from: p.from ?? null, to: p.to, why: p.why },
      };
    });
  return { events, lastSeq: cursor };
}

/** Everything running or asleep in the Space that the viewer may see in full, newest first: what the "Running and asleep" list reads. Managers may ask for all of it. */
export async function activityList(ctx: RunsCtx, input: In): Promise<unknown> {
  const all = input.scope === "all";
  if (all && !isSystemCall(ctx as Parameters<typeof isSystemCall>[0]) && !mayManage(ctx, { id: "runs", owner: "" }))
    raise(ctx, "permission.role_lacks_permission", "Only someone who manages runs can see everyone's.", {
      reason: "manage_required",
    });
  const rows = liveNodes(
    ctx.db,
    all ? undefined : (ctx.actingFor ?? ctx.principal.id),
    Math.min(200, input.limit ?? 100),
  );
  return {
    rows: rows.map((n) => ({
      runId: n.id,
      rootRun: n.rootRun,
      kind: n.kind,
      ...(n.name === undefined ? {} : { name: n.name }),
      whoKind: n.whoKind,
      ...(n.whoId === undefined ? {} : { whoId: n.whoId }),
      status: n.status,
      ...(n.wake === undefined ? {} : { wake: n.wake }),
      startedAt: n.startedAt,
      updatedAt: n.updatedAt,
      usdMicros: n.spent.usdMicros,
    })),
  };
}

/** The host's sweep, every few seconds: nodes whose worker stopped beating go back to the queue with the next attempt. */
export const NODE_SWEEP_MS = 5_000;
export function nodeSweep(ctx: RunsCtx): void {
  reclaimExpired(ctx);
}

// ---- the board and the messages of a tree (board.ts) ----

/** Who may speak as a node: the server, the node's own agent, and the owner or a manager of the work. */
function speaksFor(ctx: RunsCtx, n: Node): void {
  if (isSystemCall(ctx as Parameters<typeof isSystemCall>[0])) return;
  if (n.whoKind === "agent" && n.whoId !== undefined && n.whoId === ctx.principal.id) return;
  if (mayManage(ctx, { id: n.id, owner: n.owner })) return;
  raise(ctx, "permission.not_found", "That run is not available.");
}
const fullOnly = (ctx: RunsCtx, id: string): Node => {
  const { node, full } = look(ctx, id);
  if (!full) raise(ctx, "permission.not_found", "That run is not available.");
  return node;
};

export async function boardPutCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = getNode(ctx, input.runId);
  speaksFor(ctx, n);
  if (n.status === "succeeded" || n.status === "failed" || n.status === "stopped")
    raise(ctx, "validation.precondition_failed", "That run has already finished.", {
      reason: "run_finished",
      status: n.status,
    });
  return boardPut(ctx, n, input as Parameters<typeof boardPut>[2]);
}
export async function boardAnswerCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = getNode(ctx, input.runId);
  const root = findNode(ctx.db, n.rootRun) ?? n;
  // the node that asked may not answer itself: its parent's agent, the owner, a manager, or the server
  const parent = n.parentRun ? findNode(ctx.db, n.parentRun) : undefined;
  const parentAgent = parent?.whoKind === "agent" && parent.whoId !== undefined && parent.whoId === ctx.principal.id;
  if (
    !isSystemCall(ctx as Parameters<typeof isSystemCall>[0]) &&
    !parentAgent &&
    !mayManage(ctx, { id: root.id, owner: root.owner })
  )
    raise(ctx, "permission.not_found", "That run is not available.");
  return { entry: boardAnswer(ctx, input.entryId, ctx.actingFor ?? ctx.principal.id, input.text) };
}
export async function boardListCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = look(ctx, input.runId);
  // another person in the chat is not told what the nodes know
  return { entries: n.full ? boardList(ctx.db, n.node.rootRun, input.all === true) : [] };
}
export async function messageSendCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const from = getNode(ctx, input.runId);
  speaksFor(ctx, from);
  return messageSend(ctx, from, input.to, input.body, input.key);
}
export async function messageTakeCap(ctx: RunsCtx, input: In): Promise<unknown> {
  if (!isSystemCall(ctx as Parameters<typeof isSystemCall>[0]))
    raise(ctx, "permission.no_grant", "That is for the server, not for a person.", { reason: "system_call" });
  getNode(ctx, input.runId);
  return { messages: takeMessages(ctx, input.runId) };
}
export async function messageSeenCap(ctx: RunsCtx, input: In): Promise<unknown> {
  if (!isSystemCall(ctx as Parameters<typeof isSystemCall>[0]))
    raise(ctx, "permission.no_grant", "That is for the server, not for a person.", { reason: "system_call" });
  return { marked: markSeen(ctx, input.messageIds) };
}
export async function messageListCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const n = fullOnly(ctx, input.runId);
  return { messages: input.tree === true ? messagesInTree(ctx.db, n.rootRun) : messagesOf(ctx.db, n.id) };
}
