// Background waits (spec 2.13 Waiting, 2.12 "every wait has a timeout"; ARCH 6.8, 7.7): a Run waits on an event, another Run or a time, with a timeout (default 30 days)
// and conditions that cancel it. The event consumer calls scheduler.waits.match for every event; the host tick calls scheduler.waits.expire.
// DECISION: a wake is made through the runs module. A Run of kind `wait` (the one runs.wait_for makes) is finished as succeeded with a summary the waking thread reads
//   ("Matched record.updated.", "Timed out waiting for record.updated."); any other Run is resumed and its step reads the clock and the event (a timeout is the step's resumedBy "timeout").
// DECISION: a wait on a time ends through waits.expire at its time (expiresAt is that time), so one clock path serves timeouts and times. Its Run reads "The time came."
// DECISION: cancelsOn names event types. An event of such a type cancels the wait when it is about the wait's subject (its subject or payload.recordId), or, for a wait with no subject,
//   when its payload.runId is the wait's Run (run.stopped). A cancel stops the Run; a wait that matches and cancels in the same event is canceled.
import {
  durationMs, emitWait, endWait, filterMatches, findWait, newId, openEventWaits, openWaits, openWaitsOnRun, page, raise, readPolicy, saveWait, waitOut, waitsFor, idemFind, idemSave, clean,
} from "../projections.ts";
import type { ResourceRef, SchedCtx, Wait, WaitOn } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type Reason = "subject_deleted" | "left_stage" | "stopped" | "manual";
const RUN_ENDED = new Set(["run.succeeded", "run.failed", "run.stopped"]);

const describeOn = (on: WaitOn): string => ("event" in on ? on.event : "run" in on ? `run ${on.run}` : "a time");

export async function register(ctx: SchedCtx, input: In): Promise<unknown> {
  const key = input.idempotencyKey as string | undefined;
  if (key) {
    const have = idemFind(ctx.db, `wait:${key}`);
    const w = have ? findWait(ctx.db, have) : undefined;
    if (w) return { waitId: w.id, expiresAt: w.expiresAt };
  }
  const on = input.on as WaitOn;
  const now = ctx.now();
  let expiresAt: number;
  if ("at" in on) expiresAt = on.at;
  else {
    const ms = input.timeout === undefined ? readPolicy(ctx.db).defaultWaitMs : durationMs(String(input.timeout));
    if (ms === undefined || ms <= 0) raise(ctx, "validation.precondition_failed", "A timeout is a number and a unit: 30s, 15m, 6h, 30d or 2w.", { reason: "bad_duration" });
    expiresAt = now + ms;
  }
  const w: Wait = {
    id: newId("wat", now), runId: input.runId, on, expiresAt, cancelsOn: [...new Set<string>(input.cancelsOn ?? [])], state: "open", createdAt: now,
    ...(input.subject ? { subject: { type: input.subject.type, id: input.subject.id } } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.stepId ? { stepId: input.stepId } : {}),
  };
  saveWait(ctx.db, w);
  if (key) idemSave(ctx.db, `wait:${key}`, w.id);
  emitWait(ctx, "wait.registered", w.runId, { waitId: w.id, on: w.on, expiresAt });
  return { waitId: w.id, expiresAt };
}

/** Run `f`; a Run that is gone or no longer waiting is not an error for the scheduler (someone else already woke or ended it). */
async function quietly(f: () => Promise<unknown>): Promise<unknown> {
  try { return await f(); } catch (e) {
    const code = (e as { error?: { code?: string } } | null)?.error?.code;
    if (code === "validation.precondition_failed" || code === "validation.not_found" || code === "permission.not_found") return undefined;
    throw e;
  }
}

async function wake(ctx: SchedCtx, w: Wait, summary: string): Promise<void> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The scheduler cannot wake a run right now.");
  const got = (await quietly(() => ctx.call!("runs.get", { runId: w.runId }))) as { run?: { kind?: string; status?: string } } | undefined;
  if (!got?.run) return;
  if (got.run.kind === "wait") await quietly(() => ctx.call!("runs.finish", { runId: w.runId, status: "succeeded", summary }));
  else await quietly(() => ctx.call!("runs.resume", { runId: w.runId, reason: "background" }));
}

function reasonFor(type: string): Reason {
  if (type.endsWith(".deleted")) return "subject_deleted";
  if (type === "run.stopped") return "stopped";
  if (/stage_(exited|left)|left_stage/.test(type)) return "left_stage";
  return "manual";
}

interface Ev { id?: string; type: string; subject?: ResourceRef; payload?: unknown }
const payloadOf = (ev: Ev): Record<string, unknown> => (ev.payload && typeof ev.payload === "object" ? ev.payload : {}) as Record<string, unknown>;

function cancels(w: Wait, ev: Ev): boolean {
  if (!w.cancelsOn.includes(ev.type)) return false;
  const p = payloadOf(ev);
  if (w.subject) return (ev.subject?.type === w.subject.type && ev.subject.id === w.subject.id) || p.recordId === w.subject.id;
  return p.runId === w.runId;
}
function matches(w: Wait, ev: Ev): boolean {
  const on = w.on;
  if ("run" in on) return RUN_ENDED.has(ev.type) && payloadOf(ev).runId === on.run;
  if (!("event" in on)) return false;
  if (on.event !== ev.type && !(on.event.endsWith(".*") && ev.type.startsWith(on.event.slice(0, -1)))) return false;
  return filterMatches(on.filter, ev.payload);
}

export async function match(ctx: SchedCtx, input: In): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The scheduler cannot read events right now.");
  const got = (await ctx.call("events.get", { eventId: input.eventId })) as { event?: Ev } | null;
  const ev = got?.event;
  if (!ev) raise(ctx, "validation.not_found", "That event does not exist.", { reason: "no_such_event" });
  const now = ctx.now();
  const canceled = new Set<string>();
  for (const w of openWaits(ctx.db)) {
    if (!cancels(w, ev)) continue;
    const reason = reasonFor(ev.type);
    await quietly(() => ctx.call!("runs.stop", { runId: w.runId, reason: `Canceled by ${ev.type}.` }));
    endWait(ctx.db, w.id, "canceled", now);
    canceled.add(w.id);
    emitWait(ctx, "wait.canceled", w.runId, { waitId: w.id, reason });
  }
  const hits = new Map<string, Wait>();
  for (const w of openEventWaits(ctx.db, ev.type)) if (matches(w, ev)) hits.set(w.id, w);
  if (RUN_ENDED.has(ev.type) && typeof payloadOf(ev).runId === "string") for (const w of openWaitsOnRun(ctx.db, payloadOf(ev).runId as string)) if (matches(w, ev)) hits.set(w.id, w);
  let matched = 0;
  for (const w of hits.values()) {
    if (canceled.has(w.id)) continue;
    const target = "run" in w.on ? `Run ${w.on.run} ${ev.type.slice("run.".length)}.` : `Matched ${ev.type}.`;
    await wake(ctx, w, target);
    endWait(ctx.db, w.id, "matched", now);
    emitWait(ctx, "wait.matched", w.runId, clean({ waitId: w.id, matchedEventId: ev.id }));
    matched += 1;
  }
  return { matched };
}

export async function cancelWait(ctx: SchedCtx, input: In): Promise<unknown> {
  const w = findWait(ctx.db, input.waitId);
  if (!w) raise(ctx, "validation.not_found", "That wait does not exist.", { reason: "no_such_wait" });
  if (w.state !== "open") return { canceled: false };
  endWait(ctx.db, w.id, "canceled", ctx.now());
  emitWait(ctx, "wait.canceled", w.runId, { waitId: w.id, reason: input.reason });
  return { canceled: true };
}

export async function expire(ctx: SchedCtx): Promise<unknown> {
  const now = ctx.now();
  let expired = 0;
  for (const w of openWaits(ctx.db)) {
    if (w.expiresAt > now) continue;
    await wake(ctx, w, "at" in w.on ? "The time came." : `Timed out waiting for ${describeOn(w.on)}.`);
    endWait(ctx.db, w.id, "expired", now);
    emitWait(ctx, "wait.expired", w.runId, { waitId: w.id });
    expired += 1;
  }
  return { expired };
}

export async function listWaits(ctx: SchedCtx, input: In): Promise<unknown> {
  const rows = waitsFor(ctx.db, { runId: input.runId, subject: input.subject, threadId: input.threadId });
  const p = page(rows, input.cursor, input.limit);
  return clean({ waits: p.rows.map(waitOut), next: p.next, total: p.total });
}
