// Control steps and the step runner (spec 2.12, 3.7; ARCH 7.7): If, Paths, Parallel, Loop, Stop, Wait, Wait for a Journey stage and Approval, the capability-call steps (data, send,
// Journey, sign) and `steps.test`. `runStep` runs ONE step of a Run: it fills the `{{ }}` templates from the Run's scope, calls the capability as the Run's principal, and answers
// with what the Run engine (modules/runs `drive`) expects: an output, where to go next, or a wait. Steps keep no state between calls; a Run resumes by calling the step again.
// DECISION: a step is idempotent through the key the engine hands it (run:step:attempt); that key goes to every capability that takes an idempotencyKey.
// DECISION: an outward act that the Gate holds parks the Run as waiting for approval on the Gate's task; when the task is decided the engine calls the step again with the same key and the
// capability returns what the released act did.
// DECISION: Parallel and Loop do not run inner steps. The host starts one child Run per lane or iteration and calls the step again with those Runs' states. This step only joins.
// A lane or iteration that failed fails the step by name once every required child is terminal. `prepare` asks a Loop for its iteration keys before any child exists.
// DECISION: a Wait that is resumed and has no way to tell why (no startedAt from the engine) is over; a Wait that is cancelled by one of its cancel-on events is ended by the engine, not here.
// A relative milestone that is already past succeeds with missed output so later outward steps can be skipped. An anchor id is re-read from the calendar when the wait resumes.
import { registry } from "../../../generated/registry.ts";
import { collectItems, groupItems, transformValue } from "./data-steps.ts";
import { nextOpen } from "./hours.ts";
import type { OpenHours } from "./hours.ts";
import { SHEET_STEPS } from "./sheets.ts";
import { clean, durationMs, evalExpr, momentMs, raise, render, stepError, truthy } from "../projections.ts";
import type { Scope, StepsCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the shapes shared with the Run engine (structural: modules do not import each other) ----

export interface Branch { label: string; to: string }
export interface StepNode { id: string; key: string; input: Record<string, unknown>; branches?: Branch[]; next?: string[]; ai?: Record<string, unknown> }
export interface WaitSpec {
  reason: "approval" | "background" | "key";
  taskId?: string;
  on?: string;
  /** wake at this time (a duration or a time) */
  at?: number;
  /** wake on this event */
  event?: { event: string; filter?: unknown };
  /** give up waiting at this time (the step then ends with resumedBy "timeout") */
  timeoutAt?: number;
  /** events that cancel the wait and end the Run */
  cancelOn?: string[];
  /** calendar event this milestone follows; a matching delete ends the wait */
  anchorId?: string;
  /** another Run this step is waiting on */
  runId?: string;
}
export interface LoopIteration { iterationKey: string; iterationIndex: number; item: unknown }
/** One child Run as the host last read it. `id` is the lane id or the iteration key. */
export interface ChildReport {
  id: string;
  runId?: string;
  status: string;
  error?: string;
  laneId?: string;
  iterationKey?: string;
  iterationIndex?: number;
  held?: boolean;
}
export interface StepResult { output?: unknown; next?: string | null; wait?: WaitSpec; prepare?: { iterations: LoopIteration[] } }
export interface StepCall {
  attempt: number;
  /** run:step:attempt */
  key: string;
  outputs: Readonly<Record<string, unknown>>;
  sandbox: boolean;
  resumed: boolean;
  /** what started the Run ($trigger) */
  trigger?: unknown;
  vars?: Record<string, unknown>;
  /** when this step first started, kept across waits; lets a Wait tell a timeout from a match */
  startedAt?: number;
  /** a loop iteration */
  item?: unknown;
  index?: number;
  /** Loop only: return iteration keys and do not join */
  prepare?: boolean;
  /** child Runs the host already started for this Parallel or Loop */
  children?: ChildReport[];
  /** wake time recorded when this step last parked, used if the anchor cannot be re-read */
  priorAt?: number;
}
export interface StepEnv {
  ctx: StepsCtx;
  run: { id: string; label?: string; automation?: string; depth?: number };
  defaults?: { mailboxId?: string; numberId?: string };
  /** AI and code steps run in the agent and sandbox services */
  ai?: (node: StepNode, input: Record<string, unknown>, call: StepCall) => Promise<StepResult>;
  code?: (node: StepNode, input: Record<string, unknown>, call: StepCall) => Promise<StepResult>;
}

const STEPS = new Map(registry.steps.map((s) => [s.key, s] as const));
const CAPS = new Map(registry.capabilities.map((c) => [c.name, c] as const));
const DAY30 = "30d";

export function scopeOf(env: StepEnv, call: Pick<StepCall, "trigger" | "outputs" | "vars" | "item" | "index">): Scope {
  const steps = Object.fromEntries(Object.entries(call.outputs).map(([k, v]) => [k, { out: v }]));
  return clean({ trigger: call.trigger, steps, vars: call.vars ?? {}, item: call.item, index: call.index, run: { id: env.run.id }, now: env.ctx.now() });
}

const branchTo = (node: StepNode, ...labels: string[]): string | undefined =>
  node.branches?.find((b) => labels.includes(b.label.trim().toLowerCase()))?.to;

// ---- If, Paths, Stop ----

/** A condition or a list is an expression; when a `{{ }}` template already turned it into a value, that value is used as it is. */
const valueOf = (v: unknown, scope: Scope): unknown => (typeof v === "string" ? evalExpr(v, scope) : v);

function ifStep(node: StepNode, i: In, scope: Scope): StepResult {
  const result = truthy(valueOf(i.condition, scope));
  if (!node.branches?.length) return { output: { result } };
  // with branches, a path that has no branch for the answer ends there
  const to = result ? branchTo(node, "then", "yes", "true") : branchTo(node, "else", "no", "false");
  return { output: { result }, next: to ?? null };
}

function pathsStep(node: StepNode, i: In, scope: Scope): StepResult {
  const paths = (i.paths ?? []) as { name: string; when: string }[];
  for (const p of paths) {
    if (truthy(valueOf(p.when, scope))) {
      const to = branchTo(node, p.name.trim().toLowerCase());
      return { output: { taken: p.name }, ...(to ? { next: to } : {}) };
    }
  }
  if (i.otherwise === true) {
    const to = branchTo(node, "otherwise", "else");
    return { output: { taken: "otherwise" }, ...(to ? { next: to } : {}) };
  }
  return { output: { taken: "" }, next: null };
}

function stopStep(i: In): StepResult {
  if (i.outcome === "failed") throw stepError("run.stopped", typeof i.message === "string" && i.message ? i.message : "The run was stopped on purpose.", false);
  return { output: { stopped: true, ...(typeof i.message === "string" && i.message ? { message: i.message } : {}) }, next: null };
}

// ---- Parallel and Loop (coordinators: the host owns the child Runs) ----

const TERMINAL = new Set(["succeeded", "failed", "stopped"]);
const LOOP_HARD_MAX = 1000;
const LOOP_DEFAULT_MAX = 500;
const childWait = (env: StepEnv, nodeId: string): WaitSpec => ({
  reason: "background", on: "child runs",
  event: { event: "run.child_terminal", filter: { parentRunId: env.run.id, containerNodeId: nodeId } },
});
const openChild = (c: ChildReport): boolean => !TERMINAL.has(c.status);
const childReason = (c: ChildReport | undefined): string => c?.error?.trim() ? c.error : "it did not finish";

function parallelStep(env: StepEnv, node: StepNode, i: In, call: StepCall): StepResult {
  const children = call.children;
  if (!children) throw stepError("run.no_lanes", "This run cannot run lanes side by side here.", false);
  if (children.length === 0) return { output: { finished: [] } };
  const open = children.filter(openChild);
  if (i.waitFor === "any") {
    const won = children.find((c) => c.status === "succeeded");
    if (open.length > 0) return { wait: childWait(env, node.id) };
    if (won) return { output: { finished: [won.id] } };
    const first = children.find((c) => c.status === "failed") ?? children[0];
    throw stepError("run.branch_failed", `No lane finished: ${childReason(first)}`, false);
  }
  if (open.length > 0) return { wait: childWait(env, node.id) };
  const failed = children.filter((c) => c.status === "failed");
  if (failed.length > 0) {
    const first = failed[0]!;
    const who = failed.length === 1 ? `The lane ${first.id}` : `${failed.length} lanes`;
    throw stepError("run.branch_failed", `${who} did not finish: ${childReason(first)}`, false);
  }
  const stopped = children.find((c) => c.status === "stopped");
  if (stopped) throw stepError("run.branch_failed", `The lane ${stopped.id} did not finish: ${childReason(stopped)}`, false);
  return { output: { finished: children.map((c) => c.id) } };
}

/** Stable key for one item. An object id is used until it repeats, then the index is prefixed. */
export function iterationKey(item: unknown, index: number, seen: Set<string>): string {
  let key = String(index);
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) key = id;
  }
  if (seen.has(key)) key = `${index}:${key}`;
  seen.add(key);
  return key;
}

function loopItems(i: In, scope: Scope): unknown[] {
  const items = valueOf(i.items, scope);
  if (!Array.isArray(items)) throw stepError("validation.bad_input", "Loop needs a list to go through.");
  const requested = typeof i.maxIterations === "number" ? i.maxIterations : LOOP_DEFAULT_MAX;
  if (requested > LOOP_HARD_MAX) throw stepError("run.loop_too_large", "A loop allows at most 1000 iterations.", false);
  if (items.length > requested) throw stepError("run.loop_too_large", `The list has ${items.length} items and the loop allows ${requested}. Raise the limit or narrow the list.`, false);
  return items;
}

function loopStep(env: StepEnv, node: StepNode, i: In, scope: Scope, call: StepCall): StepResult {
  const items = loopItems(i, scope);
  if (call.prepare || items.length === 0) {
    if (items.length === 0) return { output: { iterations: 0, results: [] } };
    const seen = new Set<string>();
    const iterations = items.map((item, iterationIndex) => ({ iterationKey: iterationKey(item, iterationIndex, seen), iterationIndex, item }));
    if (call.prepare) return { prepare: { iterations } };
  }
  const children = call.children;
  if (!children) throw stepError("run.no_body", "This loop has no steps to run.", false);
  if (children.some(openChild)) return { wait: childWait(env, node.id) };
  const byIndex = (a: ChildReport, b: ChildReport) => (a.iterationIndex ?? 0) - (b.iterationIndex ?? 0);
  const failed = children.filter((c) => c.status === "failed").sort(byIndex);
  if (failed.length > 0) {
    const f = failed[0]!;
    throw stepError("run.loop_failed", `Item ${(f.iterationIndex ?? 0) + 1} of ${items.length} failed: ${childReason(f)}`, false);
  }
  const stopped = children.filter((c) => c.status !== "succeeded").sort(byIndex);
  if (stopped.length > 0) {
    const f = stopped[0]!;
    throw stepError("run.loop_failed", `Item ${(f.iterationIndex ?? 0) + 1} of ${items.length} failed: ${childReason(f)}`, false);
  }
  const results = children.slice().sort(byIndex).map((c) => ({ iterationKey: c.iterationKey ?? c.id, status: c.status, ...(c.runId ? { runId: c.runId } : {}) }));
  return { output: { iterations: items.length, results } };
}

// ---- Wait and Wait for a Journey stage ----

const WAIT_CANCEL = ["record.deleted"];
const MISSED = { missed: true, skipTimeSensitive: true, reason: "milestone_passed" } as const;

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - utcMs;
}

/** A civil datetime in `timeZone` as UTC milliseconds. A zoned string, or no zone, uses the ordinary parser. */
function civilToUtc(text: string, timeZone: string | undefined, now: number): number {
  if (!timeZone || /[zZ]|[+-]\d{2}:?\d{2}$/.test(text.trim())) return momentMs(text, now);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m) return momentMs(text, now);
  const utcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  let off = zoneOffsetMs(utcGuess, timeZone);
  off = zoneOffsetMs(utcGuess - off, timeZone);
  return utcGuess - off;
}

function isMilestone(i: In, hasEvent: boolean): boolean {
  return i.anchorId !== undefined || i.direction === "before" || i.direction === "after" || (i.at !== undefined && i.forDuration === undefined && i.until === undefined && !hasEvent);
}

async function anchorBase(env: StepEnv, anchorId: string): Promise<number | undefined> {
  if (!env.ctx.call) return undefined;
  const got = (await env.ctx.call("calendar.get_event", { eventId: anchorId })) as { event?: { startsAt?: unknown } } | null;
  const raw = got?.event?.startsAt;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw) return momentMs(raw, env.ctx.now());
  return undefined;
}

function milestoneWaitSpec(label: string, at: number, anchorId: string | undefined): WaitSpec {
  return clean({
    reason: "background" as const, on: label, at, anchorId,
    event: anchorId ? { event: "calendar_event.updated", filter: { eventId: anchorId } } : undefined,
    cancelOn: WAIT_CANCEL,
  });
}

async function milestoneStep(env: StepEnv, call: StepCall, i: In): Promise<StepResult> {
  const now = env.ctx.now();
  const off = i.offset !== undefined ? durationMs(String(i.offset)) : 0;
  const sign = i.direction === "before" ? -1 : 1;
  const apply = (base: number): number => base + sign * off;
  const anchorId = typeof i.anchorId === "string" && i.anchorId ? i.anchorId : undefined;
  const fromInput = (): number | undefined => {
    if (i.at === undefined) return undefined;
    const base = typeof i.at === "number" ? i.at : civilToUtc(String(i.at), typeof i.timezone === "string" ? i.timezone : undefined, now);
    return apply(base);
  };
  if (call.resumed && anchorId) {
    let fresh: number | undefined;
    try { const base = await anchorBase(env, anchorId); if (base !== undefined) fresh = apply(base); } catch { /* keep the parked time */ }
    if (fresh === undefined) {
      if (typeof call.priorAt === "number" && call.priorAt > now) return { wait: milestoneWaitSpec("a milestone", call.priorAt, anchorId) };
      return { output: { resumedBy: "time", at: now } };
    }
    if (fresh > now) return { wait: milestoneWaitSpec("a milestone", fresh, anchorId) };
    // The parked time arrived on schedule. A milestone that moved earlier than that, and is already past, was missed.
    const arrived = typeof call.priorAt === "number" && fresh >= call.priorAt - 1000;
    if (arrived) return { output: { resumedBy: "time", at: now } };
    return { output: { ...MISSED } };
  }
  let target = fromInput();
  if (target === undefined && anchorId) {
    const base = await anchorBase(env, anchorId);
    if (base !== undefined) target = apply(base);
  }
  if (target === undefined) throw stepError("validation.bad_input", "Wait needs a time it can read.");
  if (target <= now) return { output: { ...MISSED } };
  return { wait: milestoneWaitSpec("a milestone", target, anchorId) };
}

function openHours(raw: unknown): OpenHours | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw stepError("validation.bad_input", "Open hours need a time zone, days, a start, and an end.", false);
  const h = raw as Record<string, unknown>;
  const days = Array.isArray(h.days) ? h.days.filter((day): day is number => typeof day === "number") : [];
  return { timezone: typeof h.timezone === "string" ? h.timezone : "", days, start: typeof h.start === "string" ? h.start : "", end: typeof h.end === "string" ? h.end : "" };
}

async function waitStep(env: StepEnv, call: StepCall, i: In): Promise<StepResult> {
  const now = env.ctx.now();
  const start = call.startedAt ?? now;
  const hasEvent = i.event && typeof i.event === "object" && typeof i.event.event === "string";
  if (isMilestone(i, hasEvent)) return milestoneStep(env, call, i);
  if (i.forDuration === undefined && i.until === undefined && !hasEvent) throw stepError("validation.bad_input", "Wait needs a duration, a time or an event.");
  const rawAt = i.forDuration !== undefined ? start + durationMs(String(i.forDuration)) : i.until !== undefined ? momentMs(i.until, start) : undefined;
  const hours = openHours(i.hours);
  const at = rawAt !== undefined && hours ? nextOpen(rawAt, hours) : rawAt;
  const timeoutAt = hasEvent ? start + durationMs(String(i.timeout ?? DAY30)) : undefined;
  const label = hasEvent ? `event ${i.event.event}` : i.forDuration !== undefined ? `${i.forDuration}` : "a time";
  if (call.resumed) {
    // woken: a time wait is over when its time has come; an event wait ended by its event, or by its timeout
    if (at !== undefined && call.startedAt !== undefined && now < at) return { wait: { reason: "background", on: label, at, cancelOn: WAIT_CANCEL } };
    const by = hasEvent ? (timeoutAt !== undefined && call.startedAt !== undefined && now >= timeoutAt ? "timeout" : "event") : i.forDuration !== undefined ? "duration" : "time";
    return { output: { resumedBy: by, at: now } };
  }
  return { wait: clean({ reason: "background" as const, on: label, at, event: hasEvent ? { event: String(i.event.event), filter: i.event.filter } : undefined, timeoutAt, cancelOn: WAIT_CANCEL }) };
}

function waitStage(env: StepEnv, call: StepCall, i: In): StepResult {
  const now = env.ctx.now();
  const start = call.startedAt ?? now;
  const timeoutAt = start + durationMs(String(i.timeout ?? DAY30));
  if (call.resumed) return { output: { enteredAt: now, timedOut: call.startedAt !== undefined && now >= timeoutAt } };
  return {
    wait: {
      reason: "background", on: `${i.stage} stage`, timeoutAt, cancelOn: ["record.deleted", "journey.stage_exited"],
      event: { event: "journey.stage_entered", filter: { recordId: i.recordId, stage: i.stage } },
    },
  };
}

// ---- Approval ----

async function approvalStep(env: StepEnv, node: StepNode, call: StepCall, i: In): Promise<StepResult> {
  if (!env.ctx.call) throw stepError("internal.unavailable", "Approvals are not available right now.", true);
  const now = env.ctx.now();
  const create = {
    kind: "approve", title: i.title, ...(i.summary ? { summary: i.summary } : {}), assigned: i.approver, approver: i.approver, ...(i.reviewer ? { reviewer: i.reviewer } : {}),
    ...(Array.isArray(i.blocks) ? { blocks: i.blocks } : {}), source: { kind: "run", id: env.run.id },
    ...(i.timeout !== undefined ? { expiresAt: now + durationMs(String(i.timeout)) } : {}), idempotencyKey: call.key,
  };
  // the same key returns the same task, so a resumed step finds its task again
  const made = (await env.ctx.call("tasks.create", create)) as { task?: { id?: string; state?: string; expiresAt?: number } };
  const taskId = made?.task?.id;
  if (!taskId) throw stepError("internal.unexpected", "The approval task was not created.", true);
  if (!call.resumed) return { wait: { reason: "approval", taskId, on: "an approval", cancelOn: ["task.withdrawn"] } };

  const got = (await env.ctx.call("tasks.get", { taskId })) as { task?: { state?: string; expiresAt?: number } };
  const state = got?.task?.state;
  const hist = (await env.ctx.call("tasks.history", { taskId })) as { entries?: { type?: string; by?: string; note?: string }[] };
  const last = (type: string) => (hist?.entries ?? []).find((e) => e.type === type);
  // each decision can have a branch of its own; without one the Run goes on to the next step
  const decided = (decision: string, who?: { note?: string; by?: string }): StepResult => {
    const to = branchTo(node, decision, decision.replace("_", " "));
    return { output: clean({ decision, note: who?.note, by: who?.by, taskId }), ...(to ? { next: to } : {}) };
  };
  if (state === "done") return decided("approved", last("approved"));
  if (state === "doing" || state === "canceled") return decided("rejected", last("rejected"));
  const expires = got?.task?.expiresAt ?? (typeof create.expiresAt === "number" ? create.expiresAt : undefined);
  if (expires !== undefined && now >= expires) {
    try { await env.ctx.call("tasks.withdraw", { taskId, note: "The approval timed out.", sourceKind: "run", sourceId: env.run.id }); } catch { /* the Run goes on with the answer it has */ }
    return decided("timed_out");
  }
  return { wait: { reason: "approval", taskId, on: "an approval", cancelOn: ["task.withdrawn"] } };
}

/** Start another Automation and wait until that Run finishes. The same step key returns the same Run. */
export async function callAutomation(env: StepEnv, call: StepCall, i: In): Promise<StepResult> {
  if (!env.ctx.call) throw stepError("internal.unavailable", "Runs are not available right now.", true);
  const automationId = typeof i.automationId === "string" ? i.automationId : "";
  const trigger = typeof i.trigger === "string" ? i.trigger : "";
  if (!automationId || !trigger) throw stepError("validation.bad_input", "Run another automation needs an automation and a trigger.", false);
  const depth = (env.run.depth ?? 0) + 1;
  const origin = env.run.automation ? `automation:${env.run.automation}` : undefined;
  const fired = await env.ctx.call("automations.fire", clean({
    automationId, trigger, payload: i.payload && typeof i.payload === "object" && !Array.isArray(i.payload) ? i.payload : {},
    depth, idempotencyKey: call.key, ...(origin ? { origin } : {}),
  })) as { runId?: string; dropped?: string };
  if (fired.dropped || !fired.runId) throw stepError("validation.precondition_failed", `That automation did not start${fired.dropped ? `: ${fired.dropped}` : "."}`, false);
  const got = await env.ctx.call("runs.get", { runId: fired.runId }) as { run?: { status?: string; summary?: string } };
  const status = got?.run?.status ?? "queued";
  if (status === "succeeded") return { output: { runId: fired.runId, status } };
  if (status === "failed" || status === "stopped") throw stepError("step.failed", got?.run?.summary || "The other automation did not finish.", false);
  return { wait: { reason: "background", on: automationId, runId: fired.runId } };
}

// ---- capability-call steps ----

interface Adapter {
  cap: string | ((i: In) => string);
  input?: (i: In, env: StepEnv, call: StepCall) => Promise<Record<string, unknown>> | Record<string, unknown>;
  output?: (o: any, i: In) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any
}
const people = (v: unknown): { address: string }[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((a) => ({ address: String(a) }));
const looksHtml = (s: string): boolean => /^\s*</.test(s);

const ADAPTERS: Record<string, Adapter> = {
  "records.create": { cap: "records.create", output: (o) => ({ recordId: o?.record?.id ?? o?.recordId }) },
  "records.find": { cap: "records.query", output: (o) => ({ rows: o?.rows ?? [], count: o?.total ?? (o?.rows ?? []).length }) },
  "records.update": { cap: "records.update", output: (o, i) => ({ recordId: o?.record?.id ?? i.recordId, version: o?.record?.version ?? 0 }) },
  create_task: {
    cap: "tasks.create",
    input: (i, env, call) => ({
      kind: i.kind ?? "work", title: i.title, ...(i.summary ? { summary: i.summary } : {}), assigned: i.assigned, ...(i.reviewer ? { reviewer: i.reviewer } : {}),
      ...(i.approver ? { approver: i.approver } : {}), ...(i.due !== undefined ? { due: momentMs(i.due, env.ctx.now()) } : {}), ...(i.recordId ? { recordId: i.recordId } : {}),
      source: { kind: "run", id: env.run.id }, idempotencyKey: call.key,
    }),
    output: (o) => ({ taskId: o?.task?.id }),
  },
  send_email: {
    cap: (i) => (i.draftOnly === true ? "mail.draft" : "mail.send"),
    input: (i, _env, call) => {
      const mailboxId = i.mailboxId;
      if (!mailboxId) throw stepError("validation.precondition_failed", "Send an email needs a mailbox. Pick one in the step.", false);
      const body = String(i.body ?? "");
      return {
        mailboxId, to: people(i.to), ...(i.cc ? { cc: people(i.cc) } : {}), subject: i.subject, ...(looksHtml(body) ? { html: body } : { text: body }),
        ...(Array.isArray(i.fileIds) ? { attachments: i.fileIds } : {}), ...(i.recordId ? { contactId: i.recordId } : {}), idempotencyKey: call.key,
      };
    },
    output: (o) => ({ messageId: o?.messageId ?? o?.draftId, ...(o?.threadId ? { threadId: o.threadId } : {}) }),
  },
  send_sms: {
    cap: "telephony.send_sms",
    input: (i, _env, call) => {
      const numberId = i.numberId;
      if (!numberId) throw stepError("validation.precondition_failed", "Send a text needs a number. Pick one in the step.", false);
      const media = Array.isArray(i.mediaFileIds) ? i.mediaFileIds.filter((id) => typeof id === "string" && id.length > 0) : [];
      return { numberId, to: i.to, body: i.body, ...(media.length > 0 ? { mediaFileIds: media } : {}), ...(i.recordId ? { contactId: i.recordId } : {}), idempotencyKey: call.key };
    },
    output: (o) => ({ messageId: o?.smsId ?? o?.messageId }),
  },
  post_message: {
    cap: "chat.post",
    input: async (i, env, call) => {
      let threadId = i.threadId as string | undefined;
      if (!threadId && i.channelId) threadId = ((await env.ctx.call!("channels.get", { channelId: i.channelId })) as { channel?: { mainThreadId?: string } })?.channel?.mainThreadId;
      if (!threadId) throw stepError("validation.precondition_failed", "Post a chat message needs a channel or a thread.", false);
      return { threadId, body: i.text, idempotencyKey: call.key };
    },
    output: (o) => ({ messageId: o?.message?.id ?? o?.messageId }),
  },
  start_journey: { cap: "journeys.start", output: (o, i) => ({ recordId: o?.recordId ?? i.subjectRecordId }) },
  sign: {
    cap: "esign.send",
    input: (i, _env, call) => ({ fileId: i.fileId, signers: i.signers, ...(i.recordId ? { recordId: i.recordId } : {}), idempotencyKey: call.key }),
    output: (o) => ({ envelopeId: o?.envelopeId, ...(o?.taskId ? { taskId: o.taskId } : {}) }),
  },
};

/** A call the Gate held parks the Run on the Gate's approval task; anything else is the caller's to handle. */
function gateHold(e: unknown): StepResult | undefined {
  const err = (e as { error?: { code?: string; details?: { taskId?: string } } } | null)?.error;
  if (err?.code === "permission.needs_approval" && err.details?.taskId) return { wait: { reason: "approval", taskId: err.details.taskId, on: "approval to send", cancelOn: ["task.withdrawn"] } };
  return undefined;
}

/** Call the capability a step stands for, as the Run's principal. A hold by the Gate parks the Run on the Gate's task. */
async function capabilityStep(env: StepEnv, node: StepNode, i: In, call: StepCall): Promise<StepResult> {
  if (!env.ctx.call) throw stepError("internal.unavailable", "This step cannot run right now.", true);
  const def = STEPS.get(node.key)!;
  const ad = ADAPTERS[node.key];
  const cap = ad ? (typeof ad.cap === "function" ? ad.cap(i) : ad.cap) : def.cap;
  if (!cap) throw stepError("internal.unexpected", `The step ${node.key} has no capability.`, false);
  let input: Record<string, unknown> = ad?.input ? await ad.input(i, env, call) : { ...i };
  // every capability that takes a key gets the step's own, so a retry of the same attempt is the same act
  if (!("idempotencyKey" in input) && "idempotencyKey" in ((CAPS.get(cap)?.input as { properties?: object } | undefined)?.properties ?? {})) input = { ...input, idempotencyKey: call.key };
  try {
    const out = await env.ctx.call(cap, input);
    return { output: ad?.output ? ad.output(out, i) : out };
  } catch (e) {
    const held = gateHold(e);
    if (held) return held;
    throw e;
  }
}

// ---- the runner ----

/** Run one step. Sandboxes (test mode, replay) answer every step that writes or sends with its sample and run only what reads. */
export async function runStep(env: StepEnv, node: StepNode, call: StepCall): Promise<StepResult> {
  const def = STEPS.get(node.key);
  if (!def) throw stepError("validation.bad_input", `There is no step called ${node.key}.`, false);
  const scope = scopeOf(env, call);
  const input = render(node.input, scope) as In;
  const parks = def.kind === "wait" || node.key === "approval";
  if (call.sandbox && (def.effects !== "read" || parks)) return { output: def.sample };
  switch (node.key) {
    case "if": return ifStep(node, input, scope);
    case "paths": return pathsStep(node, input, scope);
    case "stop": return stopStep(input);
    case "parallel": return parallelStep(env, node, input, call);
    case "loop": return loopStep(env, node, input, scope, call);
    case "wait": return waitStep(env, call, input);
    case "wait_stage": return waitStage(env, call, input);
    case "approval": return approvalStep(env, node, call, input);
    case "transform": return { output: { value: transformValue(input.value, input.mapping ?? {}) } };
    case "collect": return { output: collectItems(input.items, input.fields) };
    case "group_by": return { output: { groups: groupItems(input.items, String(input.by ?? "")) } };
    case "call_automation": return callAutomation(env, call, input);
    default: break;
  }
  if (def.kind === "ai") {
    if (!env.ai) throw stepError("run.no_ai", "AI steps run in the agent service, which is not connected here.", false);
    return env.ai(node, input, call);
  }
  if (def.kind === "code") {
    if (!env.code) throw stepError("run.no_code", "Code steps run in the sandbox, which is not connected here.", false);
    return env.code(node, input, call);
  }
  if (node.key.startsWith("sheet.")) {
    const f = SHEET_STEPS[node.key];
    if (!f) throw stepError("validation.bad_input", `There is no spreadsheet step called ${node.key}.`, false);
    try { return { output: await f({ ctx: env.ctx, run: env.run }, input, call.key) }; }
    catch (e) { const held = gateHold(e); if (held) return held; throw e; }
  }
  return capabilityStep(env, node, input, call);
}

// ---- steps.test ----

export async function stepsTest(ctx: StepsCtx, input: In): Promise<unknown> {
  const def = STEPS.get(input.key);
  if (!def) raise(ctx, "validation.bad_input", `There is no step called ${input.key}.`);
  const env: StepEnv = { ctx, run: { id: "run_test", label: "Test" } };
  const call: StepCall = { attempt: 1, key: "run_test:test:1", outputs: {}, sandbox: true, resumed: false, trigger: input.sample ?? {} };
  const stubbed = def.effects !== "read" || def.kind === "wait" || def.key === "approval";
  try {
    // a step that only reads runs for real; loops and lanes have nothing to run in a test
    const r = await runStep(env, { id: "test", key: input.key, input: input.input ?? {} }, call);
    return { output: r.output ?? null, stubbed };
  } catch (e) {
    const er = (e as { error?: { code?: string; message?: string } } | null)?.error;
    return { output: null, stubbed: false, error: { code: er?.code ?? "step.failed", message: er?.message ?? (e as Error).message ?? "The step failed." } };
  }
}
