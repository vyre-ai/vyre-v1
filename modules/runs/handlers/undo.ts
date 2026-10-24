// Undo this run (spec 4.5, ARCH 4.7): replay the inverse of the Run's writes for events still at the Run's version, report the rest.
// The Run's writes are the events carrying its run id (the log is the source of truth, ruling 20). The plan is made against the state before any inverse is applied, so the
// Run's own later writes to a row never count as "changed since"; the inverses then run newest first.
// Skipped, with a reason: changed_since (another write came after the Run's), not_undoable (no inverse is known), sent (a message left), deployed (a site or automation went live).
import { clean, emitRun, patchExtra, raise, seeRun, manageRun } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LoggedEvent { seq: number; id: string; type: string; at: number; subject?: { type: string; id: string }; runId?: string; payload: Record<string, unknown> }
export type SkipReason = "changed_since" | "not_undoable" | "sent" | "deployed";
export interface Inverse { cap: string; input: Record<string, unknown>; summary: string; /** what it acts on, for the skipped lines */ what: string }
export type Rule = (e: LoggedEvent) => Inverse | { skip: SkipReason; summary: string };

const recordIdOf = (e: LoggedEvent): string | undefined => {
  const v = e.payload.recordId ?? (e.subject?.type === "record" ? e.subject.id : undefined);
  return typeof v === "string" ? v : undefined;
};
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nameOf = (e: LoggedEvent): string => {
  const t = typeof e.payload.type === "string" ? e.payload.type : "record";
  return `${t} ${recordIdOf(e) ?? ""}`.trim();
};

/**
 * What undoing one event means, by event type. This is the compensation table: a module that needs its own inverse adds a rule here (a Rule returns the capability call that
 * reverses the event, or says why it cannot). Events that are not listed and match no pattern are not undoable.
 */
export const RULES: Record<string, Rule> = {
  "record.created": (e) => ({ cap: "records.delete", input: { recordId: recordIdOf(e) ?? "" }, summary: `Removed ${nameOf(e)}`, what: nameOf(e) }),
  "record.updated": (e) => {
    const prev = asRecord(e.payload.prev);
    if (Object.keys(prev).length === 0) return { skip: "not_undoable", summary: `The old values of ${nameOf(e)} were not kept` };
    return { cap: "records.update", input: { recordId: recordIdOf(e) ?? "", patch: prev }, summary: `Put back ${Object.keys(prev).join(", ")} on ${nameOf(e)}`, what: nameOf(e) };
  },
  "record.deleted": (e) => ({ cap: "records.restore", input: { recordId: recordIdOf(e) ?? "" }, summary: `Restored ${nameOf(e)} from Trash`, what: nameOf(e) }),
  "record.restored": (e) => ({ cap: "records.delete", input: { recordId: recordIdOf(e) ?? "" }, summary: `Moved ${nameOf(e)} back to Trash`, what: nameOf(e) }),
};
const SENT = /(^|\.)(sent|launched|sent_for_review|posted|called|texted)$/;
const DEPLOYED = /(^|\.)(deployed|promoted|published|released)$/;
/** Events that only describe the Run itself or its bookkeeping: never part of "what it changed". */
const BOOKKEEPING = /^(run\.|task\.|gate\.|webhook\.|health\.|log\.|audit\.|turn\.|thread\.)/;

export function ruleFor(type: string): Rule | undefined {
  const r = RULES[type];
  if (r) return r;
  if (BOOKKEEPING.test(type)) return undefined;
  if (SENT.test(type)) return (e) => ({ skip: "sent", summary: `${e.type} cannot be taken back` });
  if (DEPLOYED.test(type)) return (e) => ({ skip: "deployed", summary: `${e.type} cannot be taken back` });
  return (e) => ({ skip: "not_undoable", summary: `${e.type} has no undo` });
}

export interface Plan {
  steps: { event: LoggedEvent; inverse: Inverse }[];
  skipped: { eventId: string; summary: string; reason: SkipReason }[];
}

async function pageEvents(ctx: RunsCtx, filter: Record<string, unknown>): Promise<LoggedEvent[]> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The event log is not available right now.");
  const all: LoggedEvent[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const r = (await ctx.call("events.list", clean({ ...filter, cursor, limit: 500 }))) as { events?: LoggedEvent[]; next?: string } | null;
    all.push(...(r?.events ?? []));
    if (!r?.next) break;
    cursor = r.next;
  }
  return all.sort((a, b) => a.seq - b.seq);
}

/** Plan the undo of a Run. Reads only. */
export async function planUndo(ctx: RunsCtx, runId: string): Promise<Plan> {
  const mine = await pageEvents(ctx, { runId });
  const plan: Plan = { steps: [], skipped: [] };
  // the writes after the Run's first write to each subject, read once per subject
  const firstAt = new Map<string, number>();
  for (const e of mine) if (e.subject) { const k = `${e.subject.type}/${e.subject.id}`; firstAt.set(k, Math.min(firstAt.get(k) ?? e.at, e.at)); }
  const later = new Map<string, LoggedEvent[]>();
  const laterOn = async (e: LoggedEvent): Promise<LoggedEvent[]> => {
    if (!e.subject) return [];
    const k = `${e.subject.type}/${e.subject.id}`;
    if (!later.has(k)) later.set(k, await pageEvents(ctx, { subject: e.subject, from: firstAt.get(k) ?? e.at }));
    return later.get(k)!;
  };
  for (const e of [...mine].reverse()) {
    const rule = ruleFor(e.type);
    if (!rule) continue;
    const r = rule(e);
    if ("skip" in r) { plan.skipped.push({ eventId: e.id, summary: r.summary, reason: r.skip }); continue; }
    // still at the Run's version: no write to the same subject came after this one from anywhere but this Run
    const changed = (await laterOn(e)).some((x) => x.seq > e.seq && x.runId !== runId && !BOOKKEEPING.test(x.type));
    if (changed) { plan.skipped.push({ eventId: e.id, summary: `${r.what} changed after the run`, reason: "changed_since" }); continue; }
    plan.steps.push({ event: e, inverse: r });
  }
  return plan;
}

export async function previewUndo(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = seeRun(ctx, input.runId);
  const plan = await planUndo(ctx, run.id);
  return { undone: plan.steps.map((s) => ({ eventId: s.event.id, summary: s.inverse.summary })), skipped: plan.skipped };
}

export async function undo(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = manageRun(ctx, input.runId);
  if (run.status === "queued" || run.status === "running" || run.status === "waiting") {
    raise(ctx, "validation.precondition_failed", "Stop the run before undoing it.", { reason: "run_active", status: run.status });
  }
  const plan = await planUndo(ctx, run.id);
  const undone: { eventId: string; summary: string }[] = [];
  const skipped = [...plan.skipped];
  for (const s of plan.steps) {   // newest first
    try {
      await ctx.call!(s.inverse.cap, s.inverse.input);
      undone.push({ eventId: s.event.id, summary: s.inverse.summary });
    } catch (e) {
      const code = (e as { error?: { code?: string } } | null)?.error?.code;
      skipped.push({
        eventId: s.event.id, summary: `${s.inverse.what} could not be put back`,
        reason: code === "validation.version_conflict" || code === "validation.field_locked" ? "changed_since" : "not_undoable",
      });
    }
  }
  patchExtra(ctx.db, run.id, { undoneAt: ctx.now() });
  emitRun(ctx, "run.undone", run.id, { undone: undone.length, skipped: skipped.length });
  return { undone, skipped };
}
