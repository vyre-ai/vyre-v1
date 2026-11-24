// Flow Runs in the agent work tree (r42-runtime slice 2). A routine fire, an agent's wait and a terminal Run already live in runs_items with their own state machine and waits; this keeps one mirror node per such Run
// (same id) so the tree, the Island and the "asleep until" line see them with everything else. The Run stays the truth: the mirror only follows it. Called from saveRun and saveWait, so every state a Run reaches is seen
// however it got there.
// DECISION: the mirror holds no lease and takes no control: node.control on a mirrored node asks the Run engine (stop) or refuses (pause), since the flow engine owns its transitions.
import { appendEvent } from "./node-log.ts";
import type { LogDb } from "./node-log.ts";

/** Which flow Run kinds are mirrored, and what node kind each is. */
export const MIRRORED: Readonly<Record<string, string>> = { routine: "routine", wait: "wait", terminal: "terminal" };

interface FlowRun {
  id: string;
  kind: string;
  name?: string | undefined;
  owner: string;
  startedBy: string;
  status: string;
  modelUsed?: string | undefined;
  costMicros: number;
  startedAt: number;
  endedAt?: number | undefined;
  parentRun?: string | undefined;
  threadId?: string | undefined;
  summary?: string | undefined;
  updatedAt: number;
}
const TERMINAL = new Set(["succeeded", "failed", "stopped"]);
type Row = Record<string, unknown>;

/** A database without the node tables (a test fixture that predates them) has nothing to mirror into; any other failure is real and is thrown. */
function guarded(f: () => void): void {
  try {
    f();
  } catch (e) {
    if (!/no such table: runs_(node|event)/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

export function mirrorRun(db: LogDb, r: FlowRun): void {
  if (MIRRORED[r.kind] === undefined) return;
  guarded(() => mirrorRunNow(db, r));
}
function mirrorRunNow(db: LogDb, r: FlowRun): void {
  const kind = MIRRORED[r.kind]!;
  const have = (db.all("SELECT status, root_run, version FROM runs_node WHERE run_id = ?", r.id) as Row[])[0];
  if (!have) {
    const up = r.parentRun
      ? ((db.all("SELECT root_run, depth FROM runs_node WHERE run_id = ?", r.parentRun) as Row[])[0] ?? undefined)
      : undefined;
    const root = up ? String(up["root_run"]) : r.id;
    db.run(
      `INSERT INTO runs_node (run_id, root_run, parent_run, depth, kind, name, owner, started_by, who_kind, model, thread_id, status, version, attempt, spent_json, origin_json,
         summary, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?)`,
      r.id,
      root,
      up ? r.parentRun : null,
      up ? Number(up["depth"]) + 1 : 0,
      kind,
      r.name ?? null,
      r.owner,
      r.startedBy,
      r.modelUsed ?? null,
      r.threadId ?? null,
      r.status,
      JSON.stringify({ tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: Math.round(r.costMicros), calls: 0 }),
      JSON.stringify({ mirror: "run" }),
      r.summary ?? null,
      r.startedAt,
      r.endedAt ?? null,
      r.updatedAt,
    );
    appendEvent(db, {
      rootRun: root,
      runId: r.id,
      at: r.updatedAt,
      type: "state",
      actor: r.startedBy,
      key: "state:0",
      payload: { from: null, to: r.status, why: "started" },
    });
    if (TERMINAL.has(r.status)) ended(db, root, r);
    return;
  }
  const from = String(have["status"]);
  const root = String(have["root_run"]);
  if (from === r.status) {
    db.run(
      "UPDATE runs_node SET summary = COALESCE(?, summary), updated_at = ?, ended_at = COALESCE(?, ended_at), spent_json = ? WHERE run_id = ?",
      r.summary ?? null,
      r.updatedAt,
      r.endedAt ?? null,
      spentJson(db, r),
      r.id,
    );
    return;
  }
  const version = Number(have["version"]) + 1;
  db.run(
    "UPDATE runs_node SET status = ?, version = ?, updated_at = ?, ended_at = COALESCE(?, ended_at), summary = COALESCE(?, summary), spent_json = ? WHERE run_id = ?",
    r.status,
    version,
    r.updatedAt,
    TERMINAL.has(r.status) ? (r.endedAt ?? r.updatedAt) : null,
    r.summary ?? null,
    spentJson(db, r),
    r.id,
  );
  appendEvent(db, {
    rootRun: root,
    runId: r.id,
    at: r.updatedAt,
    type: "state",
    actor: r.startedBy,
    key: `state:${version}`,
    payload: { from, to: r.status, why: why(from, r.status) },
  });
  if (TERMINAL.has(r.status)) ended(db, root, r);
}

function spentJson(db: LogDb, r: FlowRun): string {
  const cur = (db.all("SELECT spent_json FROM runs_node WHERE run_id = ?", r.id) as Row[])[0];
  let s = { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0, calls: 0 };
  try {
    s = { ...s, ...JSON.parse(String(cur?.["spent_json"] ?? "{}")) };
  } catch {
    /* keep zeros */
  }
  return JSON.stringify({ ...s, usdMicros: Math.max(s.usdMicros, Math.round(r.costMicros)) });
}
const why = (from: string, to: string): string =>
  to === "succeeded"
    ? "done"
    : to === "failed"
      ? "failed"
      : to === "stopped"
        ? "stopped"
        : to === "waiting"
          ? "slept"
          : from === "waiting"
            ? "woke"
            : "claimed";
function ended(db: LogDb, root: string, r: FlowRun): void {
  appendEvent(db, {
    rootRun: root,
    runId: r.id,
    at: r.updatedAt,
    type: "result",
    actor: r.startedBy,
    key: "ended",
    payload: { to: r.status, summary: r.summary ?? null },
  });
}

/** What a mirrored node waits for, from the Run's wait row (an event, another Run, a time, a person's answer). */
export function mirrorWake(
  db: LogDb,
  w: { runId: string; reason: string; on?: unknown; untilAt?: number | undefined; label?: string | undefined },
): void {
  guarded(() => mirrorWakeNow(db, w));
}
function mirrorWakeNow(
  db: LogDb,
  w: { runId: string; reason: string; on?: unknown; untilAt?: number | undefined; label?: string | undefined },
): void {
  const have = (db.all("SELECT wake_json FROM runs_node WHERE run_id = ?", w.runId) as Row[])[0];
  if (!have) return;
  const on = (w.on ?? {}) as { event?: string; run?: string; at?: number };
  let wake: Record<string, unknown>;
  if (w.reason === "approval") wake = { kind: "person", label: w.label ?? "an answer" };
  else if (typeof on.run === "string") wake = { kind: "child", label: w.label ?? `run ${on.run}`, on: { run: on.run } };
  else if (typeof on.at === "number") wake = { kind: "time", label: w.label ?? "a time", dueAt: on.at };
  else if (typeof on.event === "string") wake = { kind: "event", label: w.label ?? on.event, on: { event: on.event } };
  else wake = { kind: "event", label: w.label ?? "something to happen" };
  if (w.untilAt !== undefined && wake["dueAt"] === undefined) wake["dueAt"] = w.untilAt;
  let prior: { wokeCount?: number } = {};
  try {
    prior = JSON.parse(String(have["wake_json"] ?? "{}")) ?? {};
  } catch {
    prior = {};
  }
  if (typeof prior.wokeCount === "number") wake["wokeCount"] = prior.wokeCount;
  db.run("UPDATE runs_node SET wake_json = ? WHERE run_id = ?", JSON.stringify(wake), w.runId);
}
