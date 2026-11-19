// The Run node (lane r42-runtime, DESIGN-r42-runtime.md sections 3 to 7): one durable unit of agent work, whatever started it (a turn, a helper, a subagent of any engine, a handoff, a teammate ask, a watcher, a terminal
// command, a job, an MCP client). Nodes form a tree under a root; one state machine, one event log per tree, one lease per running node.
// DECISION: nodes live in their own tables (runs_node, runs_event), not in runs_items. runs_items is a synced entity with a window of the 300 most recent rows; five helpers a message would push every automation run out of it.
// A flow Run (automation, journey, routine) keeps its row there and gets a mirror node later; the tree is read from runs_node alone.
// DECISION: every transition goes through moveNode, which compares the version it read (compare and set), checks the edge table, writes the state event and refuses anything else with a stable reason.
// DECISION: events carry a key. The same key twice for one node is one event: a duplicate delivery, a replay after a restart and a retried call cannot count twice.
import { appendEvent } from "./node-log.ts";
import { clean, newRunId, nul, raise } from "./projections.ts";
import type { Db, RunsCtx } from "./projections.ts";

export type NodeKind =
  | "turn"
  | "subagent"
  | "helper"
  | "crew"
  | "handoff"
  | "ask"
  | "routine"
  | "wait"
  | "watcher"
  | "terminal"
  | "job"
  | "mcp"
  | "other";
export const NODE_KINDS: readonly NodeKind[] = [
  "turn",
  "subagent",
  "helper",
  "crew",
  "handoff",
  "ask",
  "routine",
  "wait",
  "watcher",
  "terminal",
  "job",
  "mcp",
  "other",
];
export type NodeStatus = "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
export const NODE_STATUSES: readonly NodeStatus[] = [
  "queued",
  "running",
  "waiting",
  "paused",
  "succeeded",
  "failed",
  "stopped",
];
export const isTerminal = (s: NodeStatus): boolean => s === "succeeded" || s === "failed" || s === "stopped";
export const isLive = (s: NodeStatus): boolean => !isTerminal(s);

/** The legal edges. Terminal states have none: a retry is a new attempt on a new node. waiting goes to queued, never straight to running: a woken node passes the scheduler again (budget, slots, dependencies). waiting may end succeeded: a parked turn is over when its wake starts a turn of its own. */
export const EDGES: Readonly<Record<NodeStatus, readonly NodeStatus[]>> = {
  queued: ["running", "paused", "stopped", "failed"],
  running: ["waiting", "paused", "succeeded", "failed", "stopped", "queued"],
  waiting: ["queued", "paused", "stopped", "failed", "succeeded"],
  paused: ["queued", "stopped", "failed"],
  succeeded: [],
  failed: [],
  stopped: [],
};
export const legalEdge = (from: NodeStatus, to: NodeStatus): boolean => EDGES[from].includes(to);

/** Why a node moved. A closed list so the UI can say it in words and a test can count them. */
export type Why =
  | "started"
  | "claimed"
  | "slept"
  | "woke"
  | "paused"
  | "resumed"
  | "done"
  | "failed"
  | "stopped"
  | "worker_lost"
  | "budget"
  | "stuck"
  | "parent_stopped"
  | "parent_paused"
  | "retry"
  | "lease_lost";

export const LEASE_TTL_MS = 20_000;
export const HEARTBEAT_MS = 5_000;

export interface Wake {
  kind: "event" | "time" | "process" | "person" | "child" | "deps" | "log";
  label?: string;
  dueAt?: number;
  on?: Record<string, unknown>;
  wokeCount?: number;
}
export interface Spent {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  usdMicros: number;
  calls: number;
}
export const NO_SPEND: Spent = { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0, calls: 0 };

export interface Node {
  id: string;
  rootRun: string;
  parentRun?: string;
  depth: number;
  kind: NodeKind;
  name?: string;
  owner: string;
  startedBy: string;
  whoKind: string;
  whoId?: string;
  engine?: string;
  model?: string;
  threadId?: string;
  status: NodeStatus;
  version: number;
  attempt: number;
  brief?: unknown;
  budget?: unknown;
  spent: Spent;
  wake?: Wake;
  checkpoint?: unknown;
  result?: unknown;
  evidence?: unknown;
  origin?: unknown;
  policy?: unknown;
  summary?: string;
  /** the one line of what it is on now, with the icon that goes with it */
  step?: { icon: string; text: string };
  /** an approval it waits on: the Gate task, what it would do and why it asks */
  need?: { requestId: string; what: string; why: string };
  /** why it looks stuck (no news for a while, the same step again and again) */
  stuck?: { since: number; reason: string; escalatedAt?: number };
  whoName?: string;
  errorCode?: string;
  errorMessage?: string;
  stopReason?: string;
  leaseHolder?: string;
  leaseUntil?: number;
  heartbeatAt?: number;
  idemKey?: string;
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const js = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));
function parse<T>(v: unknown): T | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

export function nodeOf(r: Row): Node {
  return clean({
    id: String(r["run_id"]),
    rootRun: String(r["root_run"]),
    parentRun: str(r["parent_run"]),
    depth: int(r["depth"]) ?? 0,
    kind: String(r["kind"]) as NodeKind,
    name: str(r["name"]),
    owner: String(r["owner"]),
    startedBy: String(r["started_by"]),
    whoKind: String(r["who_kind"]),
    whoId: str(r["who_id"]),
    engine: str(r["engine"]),
    model: str(r["model"]),
    threadId: str(r["thread_id"]),
    status: String(r["status"]) as NodeStatus,
    version: int(r["version"]) ?? 0,
    attempt: int(r["attempt"]) ?? 1,
    brief: parse(r["brief_json"]),
    budget: parse(r["budget_json"]),
    spent: parse<Spent>(r["spent_json"]) ?? { ...NO_SPEND },
    wake: parse<Wake>(r["wake_json"]),
    checkpoint: parse(r["checkpoint_json"]),
    result: parse(r["result_json"]),
    evidence: parse(r["evidence_json"]),
    origin: parse(r["origin_json"]),
    policy: parse(r["policy_json"]),
    summary: str(r["summary"]),
    step: parse(r["step_json"]),
    need: parse(r["need_json"]),
    stuck: parse(r["stuck_json"]),
    whoName: str(r["who_name"]),
    errorCode: str(r["error_code"]),
    errorMessage: str(r["error_message"]),
    stopReason: str(r["stop_reason"]),
    leaseHolder: str(r["lease_holder"]),
    leaseUntil: int(r["lease_until"]),
    heartbeatAt: int(r["heartbeat_at"]),
    idemKey: str(r["idem_key"]),
    startedAt: int(r["started_at"]) ?? 0,
    endedAt: int(r["ended_at"]),
    updatedAt: int(r["updated_at"]) ?? 0,
  }) as Node;
}

export const findNode = (db: Db, id: string): Node | undefined => {
  const r = (db.all("SELECT * FROM runs_node WHERE run_id = ?", id) as Row[])[0];
  return r ? nodeOf(r) : undefined;
};
export function getNode(ctx: RunsCtx, id: string): Node {
  const n = findNode(ctx.db, id);
  if (!n) raise(ctx, "permission.not_found", "That run is not available.");
  return n;
}
/** Every node of a tree, oldest first, parents before children. */
export const treeNodes = (db: Db, rootRun: string): Node[] =>
  (
    db.all(
      "SELECT * FROM runs_node WHERE root_run = ? ORDER BY depth ASC, started_at ASC, run_id ASC",
      rootRun,
    ) as Row[]
  ).map(nodeOf);
export const childrenOf = (db: Db, id: string): Node[] =>
  (db.all("SELECT * FROM runs_node WHERE parent_run = ? ORDER BY started_at ASC, run_id ASC", id) as Row[]).map(nodeOf);
/** The node and everything under it (parents first). */
export function subtreeOf(db: Db, id: string): Node[] {
  const top = findNode(db, id);
  if (!top) return [];
  const all = treeNodes(db, top.rootRun);
  const by = new Map<string, Node[]>();
  for (const n of all) if (n.parentRun) (by.get(n.parentRun) ?? by.set(n.parentRun, []).get(n.parentRun)!).push(n);
  const out: Node[] = [top];
  for (let i = 0; i < out.length; i++) out.push(...(by.get(out[i]!.id) ?? []));
  return out;
}

// ---- events ----

export interface NodeEvent {
  rootRun: string;
  seq: number;
  runId: string;
  at: number;
  type: string;
  actor?: string;
  key?: string;
  payload: unknown;
}
export const EVENT_TYPES = [
  "state",
  "step",
  "said",
  "usage",
  "tool",
  "board",
  "message",
  "wait",
  "wake",
  "budget",
  "stuck",
  "result",
  "checkpoint",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const eventOf = (r: Row): NodeEvent =>
  clean({
    rootRun: String(r["root_run"]),
    seq: int(r["seq"]) ?? 0,
    runId: String(r["run_id"]),
    at: int(r["at"]) ?? 0,
    type: String(r["type"]),
    actor: str(r["actor"]),
    key: str(r["event_key"]),
    payload: parse(r["payload_json"]) ?? null,
  }) as NodeEvent;

/**
 * Append one event to a node's tree. The key makes it idempotent: the same (node, key) twice is the first event, returned again with duplicate set. A `usage` event adds to the node's own spend once.
 * Events are accepted for a node in any state, a finished one too: a late usage line still counts.
 */
export function writeEvent(
  ctx: RunsCtx,
  runId: string,
  e: { type: string; key?: string | undefined; actor?: string | undefined; payload?: unknown; at?: number | undefined },
): { seq: number; duplicate: boolean } {
  const n = findNode(ctx.db, runId);
  if (!n) raise(ctx, "permission.not_found", "That run is not available.");
  const w = appendEvent(ctx.db, {
    rootRun: n.rootRun,
    runId,
    at: e.at ?? ctx.now(),
    type: e.type,
    actor: e.actor,
    key: e.key,
    payload: e.payload,
  });
  if (w.duplicate) return w;
  if (e.type === "usage") addUsage(ctx, n, e.payload);
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (
    e.type === "step" &&
    typeof p["text"] === "string" &&
    (STEP_ICONS as readonly string[]).includes(String(p["icon"]))
  )
    ctx.db.run(
      "UPDATE runs_node SET step_json = ?, updated_at = ? WHERE run_id = ?",
      JSON.stringify({ icon: p["icon"], text: String(p["text"]).slice(0, 160) }),
      ctx.now(),
      runId,
    );
  if (e.type === "need" && typeof p["requestId"] === "string")
    ctx.db.run(
      "UPDATE runs_node SET need_json = ?, updated_at = ? WHERE run_id = ?",
      JSON.stringify({
        requestId: p["requestId"],
        what: String(p["what"] ?? "").slice(0, 160),
        why: String(p["why"] ?? "").slice(0, 200),
      }),
      ctx.now(),
      runId,
    );
  // any sign of life clears a stuck mark
  if (["step", "usage", "said", "tool", "board"].includes(e.type) && n.stuck)
    ctx.db.run("UPDATE runs_node SET stuck_json = NULL WHERE run_id = ?", runId);
  return w;
}

function addUsage(ctx: RunsCtx, n: Node, p: unknown): void {
  const u = (p ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = u[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  };
  const s = findNode(ctx.db, n.id)?.spent ?? { ...NO_SPEND };
  const next: Spent = {
    tokensIn: s.tokensIn + num("tokensIn"),
    tokensOut: s.tokensOut + num("tokensOut"),
    cacheRead: s.cacheRead + num("cacheRead"),
    usdMicros: s.usdMicros + num("usdMicros"),
    calls: s.calls + 1,
  };
  ctx.db.run(
    "UPDATE runs_node SET spent_json = ?, updated_at = ? WHERE run_id = ?",
    JSON.stringify(next),
    ctx.now(),
    n.id,
  );
}

export function eventsSince(db: Db, rootRun: string, since: number, limit: number, runId?: string): NodeEvent[] {
  const rows = (
    runId
      ? db.all(
          "SELECT * FROM runs_event WHERE root_run = ? AND seq > ? AND run_id = ? ORDER BY seq ASC LIMIT ?",
          rootRun,
          since,
          runId,
          limit,
        )
      : db.all(
          "SELECT * FROM runs_event WHERE root_run = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
          rootRun,
          since,
          limit,
        )
  ) as Row[];
  return rows.map(eventOf);
}

/** What a whole subtree has spent: the node's own spend plus every node under it. */
export function subtreeSpent(db: Db, id: string): Spent {
  const t: Spent = { ...NO_SPEND };
  for (const n of subtreeOf(db, id)) {
    t.tokensIn += n.spent.tokensIn;
    t.tokensOut += n.spent.tokensOut;
    t.cacheRead += n.spent.cacheRead;
    t.usdMicros += n.spent.usdMicros;
    t.calls += n.spent.calls;
  }
  return t;
}

// ---- start ----

export interface StartInput {
  kind: NodeKind;
  name?: string | undefined;
  owner: string;
  parentRun?: string | undefined;
  /** the parent is whichever turn of this chat is working now (a helper started by a turn names the chat it was started from); ignored when parentRun is given, and no live turn there means the node is a root */
  parentThread?: string | undefined;
  threadId?: string | undefined;
  whoKind?: string | undefined;
  whoId?: string | undefined;
  whoName?: string | undefined;
  /** nodes of the same tree this one starts after: it is not taken until each has succeeded, and it fails if one of them does not */
  dependsOn?: readonly string[] | undefined;
  engine?: string | undefined;
  model?: string | undefined;
  brief?: unknown;
  budget?: unknown;
  origin?: unknown;
  policy?: unknown;
  idemKey?: string | undefined;
  /** the node starts already running (it was running before this record was made: a helper's turn, an engine subagent's call) */
  running?: boolean | undefined;
}

/** Make a node. With an idemKey, the second call returns the first node (a retried start, a resumed caller). A child's root is its parent's root; a parent that is finished takes no new children. */
export function startNode(ctx: RunsCtx, i: StartInput): { node: Node; created: boolean } {
  if (i.idemKey !== undefined) {
    const have = (ctx.db.all("SELECT run_id FROM runs_node WHERE idem_key = ?", i.idemKey) as Row[])[0];
    if (have) return { node: getNode(ctx, String(have["run_id"])), created: false };
  }
  let root: string | undefined;
  let depth = 0;
  let parentRun = i.parentRun;
  if (parentRun === undefined && i.parentThread !== undefined) {
    const live = (
      ctx.db.all(
        "SELECT run_id FROM runs_node WHERE thread_id = ? AND kind = 'turn' AND status IN ('running','waiting') ORDER BY started_at DESC, run_id DESC LIMIT 1",
        i.parentThread,
      ) as Row[]
    )[0];
    if (live) parentRun = String(live["run_id"]);
  }
  if (parentRun !== undefined) {
    const p = findNode(ctx.db, parentRun);
    if (!p) raise(ctx, "validation.bad_input", "The parent run is not there.", { reason: "no_parent" });
    if (isTerminal(p.status))
      raise(ctx, "validation.precondition_failed", "That run has finished; it takes no new work.", {
        reason: "parent_finished",
        status: p.status,
      });
    root = p.rootRun;
    depth = p.depth + 1;
  }
  // what it starts after: nodes of this same tree, each already there. All checked before anything is written: a start that fails leaves nothing behind that a retry with the same key would find.
  for (const d of new Set(i.dependsOn ?? [])) {
    const on = findNode(ctx.db, d);
    if (!on || on.rootRun !== (root ?? "")) {
      // a node with no parent is its own root: it has nothing in its tree yet to start after
      raise(ctx, "validation.bad_input", "It can only start after work of the same job.", { reason: "bad_dependency" });
    }
  }
  const id = newRunId();
  const now = ctx.now();
  if (i.running === true && (i.dependsOn?.length ?? 0) > 0)
    raise(ctx, "validation.bad_input", "A node that is already running cannot wait for another.", {
      reason: "running_with_dependency",
    });
  const status: NodeStatus = i.running === true ? "running" : "queued";
  ctx.db.run(
    `INSERT INTO runs_node (run_id, root_run, parent_run, depth, kind, name, owner, started_by, who_kind, who_id, engine, model, thread_id, status, version, attempt,
       brief_json, budget_json, spent_json, origin_json, policy_json, idem_key, started_at, updated_at, who_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    root ?? id,
    nul(parentRun),
    depth,
    i.kind,
    nul(i.name),
    i.owner,
    ctx.principal.id,
    i.whoKind ?? ctx.principal.kind,
    nul(i.whoId ?? (ctx.principal.kind === "agent" ? ctx.principal.id : undefined)),
    nul(i.engine),
    nul(i.model),
    nul(i.threadId),
    status,
    js(i.brief),
    js(i.budget),
    JSON.stringify(NO_SPEND),
    js(i.origin),
    js(i.policy),
    nul(i.idemKey),
    now,
    now,
    nul(i.whoName),
  );
  for (const d of [...new Set(i.dependsOn ?? [])]) ctx.db.run("INSERT OR IGNORE INTO runs_dep (run_id, on_run) VALUES (?, ?)", id, d);
  const node = getNode(ctx, id);
  writeEvent(ctx, id, {
    type: "state",
    key: "state:0",
    actor: ctx.principal.id,
    payload: { from: null, to: status, why: "started" },
  });
  announce(ctx, node, null, status, "started");
  return { node, created: true };
}

function announce(ctx: RunsCtx, n: Node, from: NodeStatus | null, to: NodeStatus, why: Why): void {
  ctx.emit(
    "run.node_state",
    `run/${n.id}`,
    clean({ runId: n.id, rootRun: n.rootRun, kind: n.kind, from: from ?? undefined, to, why }),
    {
      vis: "participants",
    },
  );
  // one event that says "this node is over", whichever way: what a parent that sleeps until it ends waits on (a wait on event run.node_ended with the node's runId)
  if (isTerminal(to))
    ctx.emit("run.node_ended", `run/${n.id}`, clean({ runId: n.id, rootRun: n.rootRun, kind: n.kind, to }), {
      vis: "participants",
    });
}

// ---- move ----

export interface MoveOpts {
  why: Why;
  /** the version the caller read; the move is refused if the node has moved since */
  expectedVersion?: number | undefined;
  /** the state the caller believes the node is in; a node that already moved to `to` answers as a no-op */
  expectedFrom?: NodeStatus | undefined;
  summary?: string | undefined;
  result?: unknown;
  evidence?: unknown;
  error?: { code: string; message: string } | undefined;
  stopReason?: string | undefined;
  wake?: Wake | undefined;
  checkpoint?: unknown;
  by?: string | undefined;
}

/**
 * The one way a node changes state. Returns the node and whether this call moved it. A node already in `to` answers as a no-op (a duplicate wake, a repeated stop); a node in a terminal state refuses any other
 * move; an illegal edge and a stale version are refused with a reason a caller and a test can match.
 */
export function moveNode(ctx: RunsCtx, id: string, to: NodeStatus, o: MoveOpts): { node: Node; changed: boolean } {
  const cur = getNode(ctx, id);
  if (cur.status === to) return { node: cur, changed: false };
  if (o.expectedFrom !== undefined && cur.status !== o.expectedFrom)
    raise(ctx, "validation.precondition_failed", "That run changed while this was happening.", {
      reason: "run_moved",
      from: cur.status,
      expected: o.expectedFrom,
    });
  if (o.expectedVersion !== undefined && cur.version !== o.expectedVersion)
    raise(ctx, "validation.precondition_failed", "That run changed while this was happening.", {
      reason: "stale_version",
      version: cur.version,
    });
  if (cur.status === "queued" && to === "running" && unmetDeps(ctx.db, id).length > 0)
    raise(ctx, "validation.precondition_failed", "It starts after other work that is not done yet.", { reason: "dependency_unmet" });
  if (!legalEdge(cur.status, to))
    raise(
      ctx,
      "validation.precondition_failed",
      isTerminal(cur.status) ? "That run has already finished." : "That run cannot do that now.",
      {
        reason: isTerminal(cur.status) ? "run_finished" : "illegal_move",
        from: cur.status,
        to,
      },
    );
  // a node that wakes while something above it is paused does not run: it is paused on wake
  if (cur.status === "waiting" && to === "queued" && ancestorPaused(ctx.db, cur))
    return moveNode(ctx, id, "paused", { ...o, why: "parent_paused" });
  const now = ctx.now();
  const ending = isTerminal(to);
  const leaving = to !== "running";
  const nextAttempt = cur.status === "running" && to === "queued" ? cur.attempt + 1 : cur.attempt;
  const wake: Wake | undefined = to === "waiting" ? o.wake : undefined;
  // a node that sleeps and wakes counts its wakes, so "Asleep until the build finishes, woke 3 times" is a fact
  const woke = cur.status === "waiting" && to === "queued" ? (cur.wake?.wokeCount ?? 0) + 1 : undefined;
  const keepWake: Wake | undefined =
    to === "queued" && woke !== undefined ? { ...(cur.wake ?? { kind: "event" }), wokeCount: woke } : wake;
  const r = ctx.db.run(
    `UPDATE runs_node SET status = ?, version = version + 1, attempt = ?, updated_at = ?,
       ended_at = CASE WHEN ? THEN ? ELSE ended_at END,
       summary = COALESCE(?, summary), result_json = COALESCE(?, result_json), evidence_json = COALESCE(?, evidence_json),
       error_code = COALESCE(?, error_code), error_message = COALESCE(?, error_message), stop_reason = COALESCE(?, stop_reason),
       wake_json = CASE WHEN ? THEN ? ELSE wake_json END,
       checkpoint_json = COALESCE(?, checkpoint_json),
       lease_holder = CASE WHEN ? THEN NULL ELSE lease_holder END, lease_until = CASE WHEN ? THEN NULL ELSE lease_until END,
       need_json = CASE WHEN status = 'waiting' THEN NULL ELSE need_json END, stuck_json = NULL
     WHERE run_id = ? AND version = ?`,
    to,
    nextAttempt,
    now,
    ending ? 1 : 0,
    now,
    nul(o.summary),
    o.result === undefined ? null : JSON.stringify(o.result),
    o.evidence === undefined ? null : JSON.stringify(o.evidence),
    nul(o.error?.code),
    nul(o.error?.message),
    nul(o.stopReason),
    to === "waiting" || (to === "queued" && woke !== undefined) ? 1 : 0,
    js(keepWake),
    o.checkpoint === undefined ? null : JSON.stringify(o.checkpoint),
    leaving ? 1 : 0,
    leaving ? 1 : 0,
    id,
    cur.version,
  );
  if (r.changes !== 1) {
    // lost a race with another writer: whoever got there first decides; if it landed on the same state this is the no-op
    const again = getNode(ctx, id);
    if (again.status === to) return { node: again, changed: false };
    raise(ctx, "validation.precondition_failed", "That run changed while this was happening.", {
      reason: "stale_version",
      version: again.version,
    });
  }
  const node = getNode(ctx, id);
  writeEvent(ctx, id, {
    type: "state",
    key: `state:${node.version}`,
    actor: o.by ?? ctx.principal.id,
    payload: clean({
      from: cur.status,
      to,
      why: o.why,
      attempt: node.attempt,
      error: o.error,
      reason: o.stopReason,
      wake: wake ? clean({ ...wake }) : undefined,
    }),
  });
  announce(ctx, node, cur.status, to, o.why);
  return { node, changed: true };
}

function ancestorPaused(db: Db, n: Node): boolean {
  for (let p = n.parentRun, i = 0; p !== undefined && i < 64; i++) {
    const a = findNode(db, p);
    if (!a) return false;
    if (a.status === "paused") return true;
    p = a.parentRun;
  }
  return false;
}

/** Stop a node and every unfinished node under it, parents first so a child cannot wake a parent that is going. A finished node stays as it is. */
export function stopSubtree(ctx: RunsCtx, id: string, reason: string | undefined, by?: string): Node[] {
  const out: Node[] = [];
  for (const n of subtreeOf(ctx.db, id)) {
    if (isTerminal(n.status)) continue;
    const why: Why = n.id === id ? "stopped" : "parent_stopped";
    out.push(moveNode(ctx, n.id, "stopped", { why, stopReason: reason, by }).node);
  }
  return out;
}

/** Pause a node and everything live under it that is running or queued (a waiting node keeps its wait; it is paused when it wakes into a paused parent). Returns who moved. */
export function pauseSubtree(ctx: RunsCtx, id: string, by?: string): Node[] {
  const out: Node[] = [];
  for (const n of subtreeOf(ctx.db, id)) {
    // a sleeping node stays asleep: it is paused when it wakes into a paused parent (moveNode)
    if (n.status !== "queued" && n.status !== "running") continue;
    out.push(moveNode(ctx, n.id, "paused", { why: n.id === id ? "paused" : "parent_paused", by }).node);
  }
  return out;
}

/** Resume a paused node (and the paused nodes under it that were paused with it). They go to queued: the scheduler decides when they run. */
export function resumeSubtree(ctx: RunsCtx, id: string, by?: string): Node[] {
  const out: Node[] = [];
  for (const n of subtreeOf(ctx.db, id))
    if (n.status === "paused") out.push(moveNode(ctx, n.id, "queued", { why: "resumed", by }).node);
  return out;
}

// ---- leases ----

/**
 * Take a queued node for this holder: queued to running, with a lease that runs out LEASE_TTL_MS after the last beat. A node that is not queued, or is held by someone else whose lease is still alive, is not taken.
 * Returns the node when this call took it, undefined when it did not.
 */
export function claimNode(ctx: RunsCtx, id: string, holder: string): Node | undefined {
  const cur = findNode(ctx.db, id);
  if (!cur || cur.status !== "queued") return undefined;
  if (unmetDeps(ctx.db, id).length > 0) return undefined; // not before the work it starts after is done
  const now = ctx.now();
  if (cur.leaseUntil !== undefined && cur.leaseUntil > now && cur.leaseHolder !== holder) return undefined;
  const r = ctx.db.run(
    `UPDATE runs_node SET status = 'running', version = version + 1, lease_holder = ?, lease_until = ?, heartbeat_at = ?, updated_at = ?
     WHERE run_id = ? AND version = ? AND status = 'queued'`,
    holder,
    now + LEASE_TTL_MS,
    now,
    now,
    id,
    cur.version,
  );
  if (r.changes !== 1) return undefined;
  const node = getNode(ctx, id);
  writeEvent(ctx, id, {
    type: "state",
    key: `state:${node.version}`,
    actor: holder,
    payload: { from: "queued", to: "running", why: "claimed", attempt: node.attempt, holder },
  });
  announce(ctx, node, "queued", "running", "claimed");
  return node;
}

/** The holder's heartbeat. False when the lease ran out and someone else has the node, or the node is no longer running: the holder must stop at its next step. */
export function beatNode(ctx: RunsCtx, id: string, holder: string): boolean {
  const now = ctx.now();
  const r = ctx.db.run(
    "UPDATE runs_node SET lease_until = ?, heartbeat_at = ? WHERE run_id = ? AND status = 'running' AND lease_holder = ? AND lease_until > ?",
    now + LEASE_TTL_MS,
    now,
    id,
    holder,
    now,
  );
  return r.changes === 1;
}

/** Nodes whose holder stopped beating: running with a lease that ran out. Back to queued with the next attempt, the lease cleared. A running node with no lease rides its parent's (an engine's own subagent) and is not touched here. */
export function reclaimExpired(ctx: RunsCtx): Node[] {
  const now = ctx.now();
  const dead = ctx.db.all(
    "SELECT run_id FROM runs_node WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ? ORDER BY lease_until ASC LIMIT 200",
    now,
  ) as Row[];
  const out: Node[] = [];
  for (const d of dead) {
    try {
      const id = String(d["run_id"]);
      // a node whose worker was only WAITING for something that lives elsewhere (a command in its tab) is not queued again: it cannot be run twice, so it ends and says the thing may still be going
      const lost = (findNode(ctx.db, id)?.policy as { onLost?: string } | undefined)?.onLost === "fail";
      const m = lost
        ? moveNode(ctx, id, "failed", {
            why: "worker_lost",
            by: "svc_host",
            error: {
              code: "worker_lost",
              message:
                "The server stopped while this was running. It may still be going in its tab: look there before starting it again.",
            },
          })
        : moveNode(ctx, id, "queued", { why: "worker_lost", by: "svc_host" });
      if (m.changed) out.push(m.node);
    } catch {
      // another writer got there first; the next sweep looks again
    }
  }
  return out;
}

/** The counts the Island and Needs you read: live nodes by status for one owner. */
export function liveCounts(db: Db, owner: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.all(
    "SELECT status, COUNT(*) AS n FROM runs_node WHERE owner = ? AND status IN ('queued','running','waiting','paused') GROUP BY status",
    owner,
  ) as Row[])
    out[String(r["status"])] = int(r["n"]) ?? 0;
  return out;
}

/** Nodes that are running, asleep, paused or waiting their turn, newest first; one owner's, or everyone's when owner is left out. */
export function liveNodes(db: Db, owner: string | undefined, limit: number): Node[] {
  const rows = (
    owner === undefined
      ? db.all(
          "SELECT * FROM runs_node WHERE status IN ('queued','running','waiting','paused') ORDER BY updated_at DESC, run_id DESC LIMIT ?",
          limit,
        )
      : db.all(
          "SELECT * FROM runs_node WHERE owner = ? AND status IN ('queued','running','waiting','paused') ORDER BY updated_at DESC, run_id DESC LIMIT ?",
          owner,
          limit,
        )
  ) as Row[];
  return rows.map(nodeOf);
}

/** The nodes that ran in one chat or helper thread, newest first, with the root of each tree. active: only trees that still have a live node. */
export function nodesOfThread(db: Db, threadId: string, active: boolean, limit: number): Node[] {
  const rows = (
    db.all(
      active
        ? `SELECT n.* FROM runs_node n WHERE n.thread_id = ? AND EXISTS (SELECT 1 FROM runs_node l WHERE l.root_run = n.root_run AND l.status IN ('queued','running','waiting','paused'))
           ORDER BY n.started_at DESC, n.run_id DESC LIMIT ?`
        : "SELECT * FROM runs_node WHERE thread_id = ? ORDER BY started_at DESC, run_id DESC LIMIT ?",
      threadId,
      limit,
    ) as Row[]
  ).map(nodeOf);
  return rows;
}

// ---- dependencies ----

export const dependsOnOf = (db: Db, id: string): string[] =>
  (db.all("SELECT on_run FROM runs_dep WHERE run_id = ? ORDER BY on_run", id) as Row[]).map((r) => String(r["on_run"]));
/** The nodes this one still waits for: those it starts after that have not succeeded. */
export const unmetDeps = (db: Db, id: string): Node[] =>
  dependsOnOf(db, id)
    .map((d) => findNode(db, d))
    .filter((n): n is Node => n !== undefined && n.status !== "succeeded");

/**
 * A node that starts after work that did not finish never starts: it fails, saying which. The host's sweep, every few seconds. (A node whose dependencies are all done is claimed by its worker as usual.)
 */
export function settleDeps(ctx: RunsCtx): Node[] {
  const out: Node[] = [];
  const waiting = ctx.db.all(
    "SELECT DISTINCT d.run_id AS id FROM runs_dep d JOIN runs_node n ON n.run_id = d.run_id WHERE n.status = 'queued'",
  ) as Row[];
  for (const w of waiting) {
    const id = String(w["id"]);
    const bad = unmetDeps(ctx.db, id).find((x) => x.status === "failed" || x.status === "stopped");
    if (!bad) continue;
    try {
      out.push(
        moveNode(ctx, id, "failed", {
          why: "failed",
          by: "svc_host",
          error: {
            code: "dependency_failed",
            message: `It was to start after ${(bad.name ?? "other work").replace(/\s+/g, " ").replace(/["\u201c\u201d:]/g, "'").slice(0, 60)}, which ${bad.status === "stopped" ? "was stopped" : "did not finish"}.`,
          },
        }).node,
      );
    } catch {
      /* another writer got there first */
    }
  }
  return out;
}

// ---- what a tile says ----

export const STEP_ICONS = ["read", "web", "term", "edit", "find", "think", "send", "cal", "wait", "kid"] as const;
const STUCK_IDLE_MS = 10 * 60_000;
const SAME_STEP_TIMES = 4;

/**
 * Nodes that look stuck: running with no news for a while, or the same step (the same touched thing, not just the same tool) again and again. A node that is on a long step, or whose helpers are working, is not stuck.
 * The first time: the node is marked (the Island and the tile show it, with the reason in a plain sentence) and nudged: a message to itself that it sees at its next step. If it makes no progress for as long again, the
 * owner is told in Needs you with what it was doing; any sign of life (a step, words, use) clears all of it.
 */
export async function detectStuck(ctx: RunsCtx): Promise<Node[]> {
  const now = ctx.now();
  const out: Node[] = [];
  const rows = ctx.db.all("SELECT * FROM runs_node WHERE status = 'running' LIMIT 500") as Row[];
  for (const r of rows) {
    const n = nodeOf(r);
    // its helpers are working for it: it is waiting on them, not stuck
    const busy = (ctx.db.all("SELECT 1 AS x FROM runs_node WHERE parent_run = ? AND status IN ('queued','running','waiting','paused') LIMIT 1", n.id) as Row[]).length > 0;
    if (busy) continue;
    if (n.stuck) {
      // marked and nudged: as long again without progress, and the person hears of it, once
      if (!n.stuck.escalatedAt && now - n.stuck.since >= STUCK_IDLE_MS) {
        ctx.db.run("UPDATE runs_node SET stuck_json = ? WHERE run_id = ? AND stuck_json IS NOT NULL", JSON.stringify({ ...n.stuck, escalatedAt: now }), n.id);
        appendEvent(ctx.db, { rootRun: n.rootRun, runId: n.id, at: now, type: "stuck", actor: "svc_host", key: `stuck-told:${n.stuck.since}`, payload: { told: true } });
        try {
          await ctx.call?.(
            "tasks.create",
            clean({
              kind: "unblock",
              title: `${(n.name ?? "A helper").replace(/\s+/g, " ").slice(0, 60)} looks stuck`,
              summary: `${n.stuck.reason} It was ${n.step ? n.step.text.toLowerCase() : "working"}.`,
              why: "It was told and has not moved on. Look at it, tell it something, or stop it.",
              assigned: { kind: "person", id: n.owner },
              source: { kind: "run", id: n.id },
              idempotencyKey: `stuck:${n.id}:${n.stuck.since}`,
            }),
          );
        } catch {
          /* the mark and the event stand */
        }
        out.push(getNode(ctx, n.id));
      }
      continue;
    }
    const last = int((ctx.db.all("SELECT MAX(at) AS m FROM runs_event WHERE run_id = ? AND type != 'state'", n.id) as Row[])[0]?.["m"]) ?? n.startedAt;
    let reason: string | undefined;
    if (now - last >= STUCK_IDLE_MS) reason = `Nothing new for ${Math.floor((now - last) / 60_000)} minutes.`;
    else {
      // the same thing four times: steps that say what they touched, so four calls of one tool on four files are four steps
      const touched = (
        ctx.db.all("SELECT payload_json FROM runs_event WHERE run_id = ? AND type = 'step' ORDER BY seq DESC LIMIT 40", n.id) as Row[]
      )
        .map((x) => parse<{ detail?: string }>(x["payload_json"])?.detail)
        .filter((d): d is string => typeof d === "string" && d !== "")
        .slice(0, SAME_STEP_TIMES);
      if (touched.length === SAME_STEP_TIMES && new Set(touched).size === 1) reason = `The same step ${SAME_STEP_TIMES} times in a row.`;
    }
    if (!reason) continue;
    ctx.db.run("UPDATE runs_node SET stuck_json = ?, updated_at = ? WHERE run_id = ? AND stuck_json IS NULL", JSON.stringify({ since: now, reason }), now, n.id);
    appendEvent(ctx.db, { rootRun: n.rootRun, runId: n.id, at: now, type: "stuck", actor: "svc_host", key: `stuck:${now}`, payload: { since: now, reason } });
    ctx.db.run(
      "INSERT INTO runs_message (id, root_run, from_run, to_run, body, at, msg_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
      `msg_${newRunId().slice(4)}`,
      n.rootRun,
      n.id,
      n.id,
      `${reason} If you are stuck, say what is in the way, or try another way.`,
      now,
      `stuck:${now}`,
    );
    out.push(getNode(ctx, n.id));
  }
  return out;
}
