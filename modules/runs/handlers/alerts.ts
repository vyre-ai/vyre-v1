// Run alerts (spec 3.7 per-automation error alerts, 2.13 Needs you; ARCH 7.7): who is told when a Run fails, how often, where, and who takes over when nobody deals with it.
// `onRunFailed` is the consumer of run.failed (the host calls it once per event, like `wake`); `sweepEscalations` is the clock side (the host tick); `failedQueue` is the list the Failed runs
// screen and the Needs you badge read. They are not capabilities: the runs manifest declares none for alerts, and the configuration lives with the Automation (automations.alerts.get/set).
// DECISION: the engine already puts every failed Run in its owner's Needs you as an Unblock task (idempotency key run-failed:<run>). Alerts add to that: the people in `who` other than the owner,
//   the DM and the channel post, and the escalation chain. A person named in `who` who is the owner is not given a second task, so the Run is listed once.
// DECISION: `when` every = alert on each failed Run; after_n = alert once the Automation has failed n times in a row (the Run's `consecutive` count) and on each failure after that. Failures below n
//   are kept (a row with state quiet) and never escalate.
// DECISION: Runs that are not an Automation's (a routine, a journey, a deployment) have no alert settings: their owner's Needs you task is all. Sandbox Runs (test mode, replay) and Runs of kind
//   `wait` never alert: a wait that times out is a result the waking thread reads (engine DECISION), not a failure to chase.
// DECISION: the chain's hours are counted from the failure. A link takes over when its time has come and nobody has dealt with the Run: it was not retried, and its Unblock task is not done or
//   canceled. Every link that is due is used in one sweep, in order, each with its own task (key run-escalated:<run>:<n>), so a long outage still tells everyone it should have.
import { clean, findRun, readExtra } from "../projections.ts";
import type { Db, Run, RunKind, RunsCtx } from "../projections.ts";

const HOUR_MS = 3_600_000;

type Subject = { kind: string; id: string };
interface Alerts { who: Subject[]; when: { mode: "every" | "after_n"; n?: number }; where: { needsYou: boolean; dm: boolean; channelId?: string }; escalation: { to: Subject; afterHours: number }[] }
interface Link { to: Subject; afterHours: number }
type AlertState = "open" | "quiet" | "done" | "resolved";
interface AlertRow { runId: string; automationId?: string; state: AlertState; chain: Link[]; stage: number; nextAt?: number; failedAt: number; notified: string[]; createdAt: number }

const SKIP: readonly RunKind[] = ["automation_test", "replay", "wait"];
/** What a Run without settings gets: told to its owner only, every time, no chain. */
const DEFAULT_ALERTS: Alerts = { who: [], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] };
/** Task assignees take people, agents, groups and roles; an actor, a service or a link cannot be asked to deal with a failure. */
const ASSIGNABLE = new Set(["person", "agent", "group", "role"]);

type Raw = Record<string, unknown>;
const json = <T,>(v: unknown, fallback: T): T => { if (typeof v !== "string") return fallback; try { return JSON.parse(v) as T; } catch { return fallback; } };
function rowToAlert(r: Raw): AlertRow {
  const a: AlertRow = {
    runId: r.run_id as string, state: r.state as AlertState, chain: json<Link[]>(r.chain, []), stage: Number(r.stage ?? 0), failedAt: Number(r.failed_at ?? 0),
    notified: json<string[]>(r.notified, []), createdAt: Number(r.created_at ?? 0),
  };
  if (typeof r.automation_id === "string") a.automationId = r.automation_id;
  if (typeof r.next_at === "number") a.nextAt = r.next_at;
  return a;
}
export function findAlert(db: Db, runId: string): AlertRow | undefined {
  const r = (db.all("SELECT * FROM runs_alerts WHERE run_id = ?", runId) as Raw[])[0];
  return r ? rowToAlert(r) : undefined;
}
function saveAlert(db: Db, a: AlertRow): void {
  db.run(
    "INSERT OR REPLACE INTO runs_alerts (run_id, automation_id, state, chain, stage, next_at, failed_at, notified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    a.runId, a.automationId ?? null, a.state, JSON.stringify(a.chain), a.stage, a.nextAt ?? null, a.failedAt, JSON.stringify(a.notified), a.createdAt,
  );
}

/** The alert settings of the Automation a Run belongs to; the defaults when it has none or they cannot be read (a failure must still reach its owner). */
async function alertsOf(ctx: RunsCtx, run: Run): Promise<Alerts> {
  if (run.subject?.type !== "automation" || !ctx.call) return DEFAULT_ALERTS;
  try {
    const got = (await ctx.call("automations.alerts.get", { automationId: run.subject.id })) as { alerts?: Alerts } | null;
    return got?.alerts ?? DEFAULT_ALERTS;
  } catch { return DEFAULT_ALERTS; }
}

const label = (run: Run): string => run.name ?? "A run";
const assignee = (s: Subject): { kind: string; id: string } => ({ kind: s.kind, id: s.id });

async function task(ctx: RunsCtx, run: Run, to: Subject, key: string, title: string, summary: string): Promise<void> {
  await ctx.call!("tasks.create", clean({
    kind: "unblock", title, summary, why: "A run stopped with an error and nobody has dealt with it.", assigned: assignee(to), source: { kind: "run", id: run.id },
    recordId: run.subject?.type === "record" ? run.subject.id : undefined, idempotencyKey: key,
  }));
}

export interface AlertResult { alerted: boolean; reason?: "not_failed" | "not_tracked" | "already" | "quiet"; told: string[]; failed: { target: string; error: string }[] }

/** Handle one run.failed event: decide whether the settings call for an alert, tell the people they name, and start the escalation clock. Once per Run. */
export async function onRunFailed(ctx: RunsCtx, ev: { runId: string }): Promise<AlertResult> {
  const none = (reason: NonNullable<AlertResult["reason"]>): AlertResult => ({ alerted: false, reason, told: [], failed: [] });
  const run = findRun(ctx.db, ev.runId);
  if (!run || run.status !== "failed") return none("not_failed");
  if (SKIP.includes(run.kind)) return none("not_tracked");
  if (findAlert(ctx.db, run.id)) return none("already");
  const alerts = await alertsOf(ctx, run);
  const consecutive = readExtra(ctx.db, run.id).consecutive ?? 1;
  const due = alerts.when.mode === "every" || consecutive >= (alerts.when.n ?? 2);
  const failedAt = run.endedAt ?? ctx.now();
  const chain = [...alerts.escalation].sort((a, b) => a.afterHours - b.afterHours);
  const row: AlertRow = {
    runId: run.id, state: due ? (chain.length ? "open" : "done") : "quiet", chain: due ? chain : [], stage: 0, failedAt, notified: [], createdAt: ctx.now(),
    ...(run.subject?.type === "automation" ? { automationId: run.subject.id } : {}),
    ...(due && chain.length ? { nextAt: failedAt + chain[0]!.afterHours * HOUR_MS } : {}),
  };
  saveAlert(ctx.db, row);
  if (!due) return none("quiet");

  const told: string[] = [];
  const failed: { target: string; error: string }[] = [];
  const attempt = async (target: string, f: () => Promise<void>): Promise<void> => {
    try { await f(); told.push(target); } catch (e) { failed.push({ target, error: (e as { message?: string } | null)?.message ?? "failed" }); }
  };
  if (!ctx.call) return { alerted: true, told, failed };
  const message = readExtra(ctx.db, run.id).errorMessage ?? run.summary ?? "The run failed.";
  const title = `${label(run)} failed`;
  for (const s of alerts.who.filter((x) => ASSIGNABLE.has(x.kind) && !(x.kind === "person" && x.id === run.owner))) {
    const target = `${s.kind}:${s.id}`;
    if (alerts.where.needsYou) await attempt(`needs_you:${target}`, () => task(ctx, run, s, `run-alert:${run.id}:${target}`, title, message));
    if (alerts.where.dm && s.kind === "person") {
      await attempt(`dm:${s.id}`, async () => { await ctx.call!("chat.start", { kind: "chat", agentIds: [], personId: s.id, first: `${title}: ${message}` }); });
    }
  }
  if (alerts.where.channelId) {
    const channelId = alerts.where.channelId;
    await attempt(`channel:${channelId}`, async () => {
      const ch = (await ctx.call!("channels.get", { channelId })) as { channel?: { mainThreadId?: string } } | null;
      const threadId = ch?.channel?.mainThreadId;
      if (!threadId) throw new Error("the channel has no main thread");
      await ctx.call!("chat.post", { threadId, body: `${title}: ${message}`, idempotencyKey: `run-alert:${run.id}:channel:${channelId}` });
    });
  }
  row.notified = told;
  saveAlert(ctx.db, row);
  return { alerted: true, told, failed };
}

/** Has anybody dealt with this Run? It was retried, or the owner's Unblock task is done or canceled. */
async function dealtWith(ctx: RunsCtx, run: Run): Promise<boolean> {
  if ((ctx.db.all("SELECT 1 AS x FROM runs_extra WHERE retry_of = ? LIMIT 1", run.id) as unknown[]).length) return true;
  if (!ctx.call) return false;
  const got = (await ctx.call("tasks.list", { scope: "run", runId: run.id, kinds: ["unblock"] })) as { tasks?: { state: string }[] } | null;
  return (got?.tasks ?? []).some((t) => t.state === "done" || t.state === "canceled");
}

export interface Escalation { runId: string; stage: number; to: Subject; afterHours: number }

/** The clock side: for every failed Run whose next link has come due and that nobody dealt with, ask that link to take over. Returns who was asked. */
export async function sweepEscalations(ctx: RunsCtx): Promise<Escalation[]> {
  const out: Escalation[] = [];
  const now = ctx.now();
  const due = (ctx.db.all("SELECT * FROM runs_alerts WHERE state = 'open' AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at ASC, run_id ASC", now) as Raw[]).map(rowToAlert);
  for (const a of due) {
    const run = findRun(ctx.db, a.runId);
    if (!run || run.status !== "failed" || (await dealtWith(ctx, run))) {
      const closed: AlertRow = { ...a, state: "resolved" };
      delete closed.nextAt;
      saveAlert(ctx.db, closed);
      continue;
    }
    while (a.stage < a.chain.length && a.failedAt + a.chain[a.stage]!.afterHours * HOUR_MS <= now) {
      const link = a.chain[a.stage]!;
      if (ASSIGNABLE.has(link.to.kind)) {
        const hours = Math.round((now - a.failedAt) / HOUR_MS);
        await task(ctx, run, link.to, `run-escalated:${a.runId}:${a.stage}`, `${label(run)} is still failing`, `It failed ${hours} hour${hours === 1 ? "" : "s"} ago and nobody has dealt with it.`);
        out.push({ runId: a.runId, stage: a.stage, to: link.to, afterHours: link.afterHours });
      }
      a.stage += 1;
    }
    const next = a.chain[a.stage];
    saveAlert(ctx.db, { ...a, state: next ? "open" : "done", ...(next ? { nextAt: a.failedAt + next.afterHours * HOUR_MS } : {}) });
  }
  return out;
}

/**
 * The failed-run queue of a person: Runs they own that failed and nobody retried, newest first. A Run that was retried leaves the queue (its retry stands in for it, and if the retry fails it is
 * listed instead), so a failure is listed once however many tries it took. Sandboxes and waits are not failures to chase.
 */
export function failedQueue(db: Db, owner: string): Run[] {
  const rows = db.all(
    `SELECT i.id FROM runs_items i WHERE i.owner = ? AND i.status = 'failed' AND i.deleted_at IS NULL AND i.kind NOT IN ('automation_test', 'replay', 'wait')
       AND NOT EXISTS (SELECT 1 FROM runs_extra e WHERE e.retry_of = i.id) ORDER BY i.ended_at DESC, i.id DESC`, owner,
  ) as { id: string }[];
  return rows.map((r) => findRun(db, r.id)).filter((r): r is Run => r !== undefined);
}
