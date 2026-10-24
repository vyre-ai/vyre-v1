// Control steps and the step runner (spec 2.12, 3.7; ARCH 7.7): If, Paths, Parallel, Loop, Stop, Wait, Wait for a Journey stage and Approval, the capability-call steps (data, send,
// Journey, sign) and `steps.test`. `runStep` runs ONE step of a Run: it fills the `{{ }}` templates from the Run's scope, calls the capability as the Run's principal, and answers
// with what the Run engine (modules/runs `drive`) expects: an output, where to go next, or a wait. Steps keep no state between calls; a Run resumes by calling the step again.
// DECISION: a step is idempotent through the key the engine hands it (run:step:attempt); that key goes to every capability that takes an idempotencyKey.
// DECISION: an outward act that the Gate holds parks the Run as waiting for approval on the Gate's task; when the task is decided the engine calls the step again with the same key and the
// capability returns what the released act did.
// DECISION: Parallel and Loop run their lanes and iterations through the host (`env.lane`, `env.body`); this file owns the join: the lanes run together, the step ends when they settle, and a
// lane that failed fails the step by name after the others have finished.
// DECISION: a Wait that is resumed and has no way to tell why (no startedAt from the engine) is over; a Wait that is cancelled by one of its cancel-on events is ended by the engine, not here.
import { registry } from "../../../generated/registry.ts";
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
}
export interface StepResult { output?: unknown; next?: string | null; wait?: WaitSpec }
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
}
export interface StepEnv {
  ctx: StepsCtx;
  run: { id: string; label?: string; automation?: string };
  /** run one lane of a Parallel step to its end; rejects when the lane fails */
  lane?: (name: string) => Promise<void>;
  /** run the steps of a Loop for one item; rejects when they fail */
  body?: (item: unknown, index: number) => Promise<unknown>;
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

// ---- Parallel and Loop ----

/** Resolves with the index of the first promise to succeed; rejects with every reason once all have failed. */
function firstSuccess(ps: Promise<void>[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const reasons: unknown[] = [];
    let left = ps.length;
    ps.forEach((p, k) => p.then(() => resolve(k), (e) => { reasons[k] = e; if (--left === 0) reject(reasons); }));
  });
}
const reasonOf = (e: unknown): string => { const m = (e as { message?: unknown } | null)?.message; return typeof m === "string" && m ? m : "it did not finish"; };

async function parallelStep(env: StepEnv, i: In): Promise<StepResult> {
  const names = (i.branches ?? []) as string[];
  if (!env.lane) throw stepError("run.no_lanes", "This run cannot run lanes side by side here.", false);
  const lanes = names.map((n) => env.lane!(n));
  if (i.waitFor === "any") {
    // the first lane to finish ends the step; the others carry on in the host
    try { return { output: { finished: [names[await firstSuccess(lanes)]!] } }; }
    catch (reasons) { throw stepError("run.branch_failed", `No lane finished: ${reasonOf((reasons as unknown[]).find((r) => r !== undefined))}`, false); }
  }
  // all: the step ends when every lane has settled, so a failed lane never leaves another one running unobserved
  const settle = await Promise.allSettled(lanes);
  const failed = names.filter((_n, k) => settle[k]!.status === "rejected");
  if (failed.length > 0) {
    const first = settle.find((s): s is PromiseRejectedResult => s.status === "rejected")!.reason;
    throw stepError("run.branch_failed", `${failed.length === 1 ? `The lane ${failed[0]}` : `${failed.length} lanes`} did not finish: ${reasonOf(first)}`, false);
  }
  return { output: { finished: names } };
}

async function loopStep(env: StepEnv, i: In, scope: Scope): Promise<StepResult> {
  const items = valueOf(i.items, scope);
  if (!Array.isArray(items)) throw stepError("validation.bad_input", "Loop needs a list to go through.");
  const max = typeof i.maxIterations === "number" ? i.maxIterations : 1000;
  if (items.length > max) throw stepError("run.loop_too_large", `The list has ${items.length} items and the loop allows ${max}. Raise the limit or narrow the list.`, false);
  if (!env.body) throw stepError("run.no_body", "This loop has no steps to run.", false);
  const width = Math.max(1, Math.min(typeof i.concurrency === "number" ? i.concurrency : 1, 20));
  const results: unknown[] = new Array(items.length).fill(null);
  let nextIndex = 0;
  const state: { failure?: { index: number; message: string } } = {};
  const worker = async (): Promise<void> => {
    while (!state.failure) {
      const k = nextIndex++;
      if (k >= items.length) return;
      try { results[k] = (await env.body!(items[k], k)) ?? null; }
      catch (e) { state.failure ??= { index: k, message: (e as { message?: string } | null)?.message ?? "it failed" }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => worker()));
  if (state.failure) throw stepError("run.loop_failed", `Item ${state.failure.index + 1} of ${items.length} failed: ${state.failure.message}`, false);
  return { output: { iterations: items.length, results } };
}

// ---- Wait and Wait for a Journey stage ----

const WAIT_CANCEL = ["record.deleted"];

function waitStep(env: StepEnv, call: StepCall, i: In): StepResult {
  const now = env.ctx.now();
  const start = call.startedAt ?? now;
  const hasEvent = i.event && typeof i.event === "object" && typeof i.event.event === "string";
  if (i.forDuration === undefined && i.until === undefined && !hasEvent) throw stepError("validation.bad_input", "Wait needs a duration, a time or an event.");
  const at = i.forDuration !== undefined ? start + durationMs(String(i.forDuration)) : i.until !== undefined ? momentMs(i.until, start) : undefined;
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

// ---- capability-call steps ----

interface Adapter {
  cap: string | ((i: In) => string);
  input?: (i: In, env: StepEnv, call: StepCall) => Promise<Record<string, unknown>> | Record<string, unknown>;
  output?: (o: any, i: In) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any
}
const people = (v: unknown): { address: string }[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((a) => ({ address: String(a) }));
const looksHtml = (s: string): boolean => /^\s*</.test(s);

async function firstOf(env: StepEnv, cap: string, listKey: string): Promise<string | undefined> {
  const r = (await env.ctx.call!(cap, {})) as Record<string, { id?: string }[] | undefined>;
  return r?.[listKey]?.[0]?.id;
}

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
    input: async (i, env, call) => {
      const mailboxId = i.mailboxId ?? env.defaults?.mailboxId ?? (await firstOf(env, "mail.mailbox.list", "mailboxes"));
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
    input: async (i, env, call) => {
      const numberId = i.numberId ?? env.defaults?.numberId ?? (await firstOf(env, "telephony.number.list", "numbers"));
      if (!numberId) throw stepError("validation.precondition_failed", "Send a text needs a number. Pick one in the step.", false);
      return { numberId, to: i.to, body: i.body, ...(i.recordId ? { contactId: i.recordId } : {}), idempotencyKey: call.key };
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
    case "parallel": return parallelStep(env, input);
    case "loop": return loopStep(env, input, scope);
    case "wait": return waitStep(env, call, input);
    case "wait_stage": return waitStage(env, call, input);
    case "approval": return approvalStep(env, node, call, input);
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
