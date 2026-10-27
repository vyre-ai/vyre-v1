// Starting Runs of an Automation and the trigger consumer (spec 2.12, 3.7; ARCH 7.7).
// A Run pins the definition version it started on and the principal it acts as (the owner for a Personal Automation, the Automation's own Service principal for a Space one);
// both are kept in automations_runs for the executor. Events that trigger Automations carry `origin` and `depth`: an Automation does not retrigger itself unless allowed, and a chain
// stops at depth 8 (the setting can only lower it).
// DECISION: the depth of an event is the number of Automation hops behind it (0 for a person's or a connector's). `fire` drops depth >= the limit, so the ninth hop never starts.
// DECISION: `automations.stop` without a run id stops every active Run of the Automation and pauses it; with `pause: false` it only stops the Runs.
import { registry } from "../../../generated/registry.ts";
import { validateDefinition } from "./defs.ts";
import {
  allAutomations, clean, emitAuto, findRunLink, getAutomation, me, principalFor, raise, readPolicy, saveRunLink, touch, vaultAllowlist, versionDefinition,
} from "../projections.ts";
import type { AutoCtx, Automation, Definition, Policy, RunLink, RunScope, TriggerRef } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const TRIGGERS = new Map(registry.triggers.map((t) => [t.key, t] as const));
const rand = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
export type DropReason = "self_trigger" | "depth_limit" | "paused" | "filter_error";

export interface StartOpts {
  trigger: string; payload: unknown; test: boolean; depth: number; origin?: string | undefined; eventId?: string | undefined; version?: number | undefined;
  parentRun?: string | undefined; key: string; principal?: { kind: "person" | "service"; id: string } | undefined;
  scope?: RunScope | undefined;
  /** Park the new Run before anyone is told it started, so a loop slot does not run ahead of the concurrency cap. */
  hold?: boolean | undefined;
}

/** Create the Run through runs.start, pin the version and principal, say so. Repeating the same key returns the same Run and emits nothing. */
export async function startRun(ctx: AutoCtx, a: Automation, o: StartOpts): Promise<string> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const version = o.version ?? a.version;
  if (versionDefinition(ctx.db, a.id, version) === undefined) raise(ctx, "validation.not_found", "That version does not exist.", { reason: "no_version", version });
  const started = (await ctx.call("runs.start", clean({
    kind: o.test ? "automation_test" : "automation", name: a.name, owner: a.ownerId, subject: { type: "automation", id: a.id }, definitionVersion: version, parentRun: o.parentRun,
    idempotencyKey: o.key,
  }))) as { runId: string };
  if (findRunLink(ctx.db, started.runId)) return started.runId;
  const link: RunLink = clean({
    runId: started.runId, automationId: a.id, version, trigger: o.trigger, test: o.test, payload: o.payload, depth: o.depth, origin: o.origin, eventId: o.eventId,
    principal: o.principal ?? principalFor(a), parentRun: o.parentRun, startedAt: ctx.now(), scope: o.scope,
  }) as RunLink;
  saveRunLink(ctx.db, link);
  // A held iteration is waiting before run_started, so the drive consumer finds it parked and leaves it there.
  if (o.hold) await ctx.call("runs.mark_waiting", { runId: started.runId, reason: "background", on: "a loop slot" });
  emitAuto(ctx, "automation.run_started", a.id, clean({ runId: started.runId, trigger: o.trigger, version, test: o.test, depth: o.depth, origin: o.origin }));
  return started.runId;
}

/** What the executor needs for a Run: the pinned definition, what started it, the principal and the vault names a Space Automation may use. */
export function loadRunPlan(ctx: Pick<AutoCtx, "db">, runId: string): { link: RunLink; definition: Definition; vault: string[] } | undefined {
  const link = findRunLink(ctx.db, runId);
  if (!link) return undefined;
  const definition = versionDefinition(ctx.db, link.automationId, link.version);
  if (!definition) return undefined;
  return { link, definition, vault: link.principal.kind === "service" ? vaultAllowlist(ctx.db, link.automationId) : [] };
}

// ---- test, run, retry, replay, stop ----

function usable(ctx: AutoCtx, a: Automation): void {
  if (a.status === "paused") raise(ctx, "validation.precondition_failed", a.pausedReason ?? "This automation is paused.", { reason: "paused" });
}
function mustBeValid(ctx: AutoCtx, a: Automation): void {
  const issues = validateDefinition(a.definition, readPolicy(ctx.db));
  const bad = issues.find((i) => i.severity === "error");
  if (bad) raise(ctx, "validation.precondition_failed", bad.message, { reason: "invalid_definition", issues });
}

export async function test(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  const key: string = input.trigger ?? a.definition.triggers[0]?.key ?? "manual";
  const def = TRIGGERS.get(key);
  if (!def) raise(ctx, "validation.bad_input", `There is no trigger called ${key}.`);
  const runId = await startRun(ctx, a, {
    trigger: key, payload: input.sample ?? def.sample, test: true, depth: 0, version: input.version, key: `test:${a.id}:${ctx.now()}:${rand()}`,
    principal: { kind: "person", id: me(ctx) },
  });
  return { runId };
}

export async function run(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  usable(ctx, a);
  mustBeValid(ctx, a);
  const key: string = input.trigger ?? "manual";
  const def = TRIGGERS.get(key);
  if (!def) raise(ctx, "validation.bad_input", `There is no trigger called ${key}.`);
  const manual = "manual" in def.source || "button" in def.source;
  if (!manual) raise(ctx, "validation.precondition_failed", "Only the manual and button triggers start by hand.", { reason: "not_manual", trigger: key });
  const payload = key === "manual" ? { startedBy: me(ctx), ...(input.payload ? { input: input.payload } : {}) } : { pressedBy: me(ctx), ...(input.payload ?? {}) };
  const runId = await startRun(ctx, a, { trigger: key, payload, test: false, depth: 0, key: `run:${a.id}:${input.idempotencyKey}` });
  return { runId };
}

export async function retry(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  const old = findRunLink(ctx.db, input.runId);
  if (!old || old.automationId !== a.id) raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", { reason: "not_a_run_of_this" });
  usable(ctx, a);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const r = (await ctx.call("runs.retry", clean({ runId: old.runId, fromStep: input.fromStep }))) as { runId: string };
  if (!findRunLink(ctx.db, r.runId)) {
    saveRunLink(ctx.db, clean({ ...old, runId: r.runId, parentRun: old.runId, principal: principalFor(a), startedAt: ctx.now() }) as RunLink);
    emitAuto(ctx, "automation.run_started", a.id, clean({ runId: r.runId, trigger: old.trigger, version: old.version, test: old.test, depth: old.depth, origin: old.origin }));
  }
  return { runId: r.runId };
}

export async function replay(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  const old = findRunLink(ctx.db, input.runId);
  if (!old || old.automationId !== a.id) raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", { reason: "not_a_run_of_this" });
  usable(ctx, a);
  const version = input.version === "current" ? a.version : old.version;
  const runId = await startRun(ctx, a, {
    trigger: old.trigger, payload: old.payload, test: old.test, depth: old.depth, origin: old.origin, eventId: old.eventId, version, parentRun: old.runId,
    key: `replay:${old.runId}:${input.version}:${ctx.now()}:${rand()}`,
  });
  return { runId };
}

export async function stop(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  let ids: string[];
  if (input.runId) {
    if (findRunLink(ctx.db, input.runId)?.automationId !== a.id) raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", { reason: "not_a_run_of_this" });
    ids = [input.runId];
  } else {
    const r = (await ctx.call("runs.list", { scope: "subject", subject: { type: "automation", id: a.id }, statuses: ["queued", "running", "waiting"], limit: 500 })) as { runs?: { id: string }[] } | null;
    ids = (r?.runs ?? []).map((x) => x.id);
  }
  let stopped = 0;
  for (const id of ids) { await ctx.call("runs.stop", { runId: id, reason: "Stopped from the automation" }); stopped += 1; }
  const pause = input.pause === true || (input.runId === undefined && input.pause !== false);
  if (pause && a.status !== "paused") {
    a.status = "paused";
    a.pausedReason = `Stopped by ${ctx.principal.id}`;
    touch(ctx, a);
    emitAuto(ctx, "automation.disabled", a.id, { reason: a.pausedReason });
  }
  return { stopped };
}

// ---- fire: a matched trigger event starts a Run ----

export interface Firing { trigger: string; eventId?: string | undefined; payload: unknown; origin?: string | undefined; depth: number; key: string }

/** The guards between a matched event and a Run: paused, self-trigger, chain depth. Returns the reason an event is dropped, or null. */
export function dropReason(a: Automation, t: TriggerRef | undefined, f: Pick<Firing, "origin" | "depth">, policy: Policy): DropReason | null {
  if (a.status !== "on") return "paused";
  if (!t) return "filter_error";
  const allowed = a.definition.allowSelfTrigger === true || TRIGGERS.get(t.key)?.allowSelfTrigger === true;
  if (f.origin === `automation:${a.id}` && !allowed) return "self_trigger";
  if (f.depth >= policy.maxChainDepth) return "depth_limit";
  return null;
}

function dropped(ctx: AutoCtx, a: Automation, reason: DropReason, eventId: string | undefined): { dropped: DropReason } {
  if (eventId) emitAuto(ctx, "automation.trigger_dropped", a.id, { eventId, reason });
  return { dropped: reason };
}

export async function fireOne(ctx: AutoCtx, a: Automation, f: Firing): Promise<{ runId: string } | { dropped: DropReason }> {
  const t = a.definition.triggers.find((x) => x.key === f.trigger);
  const why = dropReason(a, t, f, readPolicy(ctx.db));
  if (why) return dropped(ctx, a, why, f.eventId);
  const runId = await startRun(ctx, a, { trigger: f.trigger, payload: f.payload, test: false, depth: f.depth, origin: f.origin, eventId: f.eventId, key: f.key });
  return { runId };
}

export async function fire(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  if (!TRIGGERS.has(input.trigger)) raise(ctx, "validation.bad_input", `There is no trigger called ${input.trigger}.`);
  if (!a.definition.triggers.some((x) => x.key === input.trigger)) raise(ctx, "validation.precondition_failed", "This automation does not use that trigger.", { reason: "no_such_trigger", trigger: input.trigger });
  const r = await fireOne(ctx, a, {
    trigger: input.trigger, eventId: input.eventId, payload: input.payload, origin: input.origin, depth: input.depth, key: `fire:${a.id}:${input.eventId ?? input.idempotencyKey}`,
  });
  return r;
}

// ---- the consumer: events in, Runs out ----

export interface LoggedEvent { id: string; type: string; payload: Record<string, unknown>; origin?: string; depth?: number; /** written by an importer or sync backfill */ imported?: boolean }

const shallowMatch = (want: unknown, have: Record<string, unknown>): boolean => {
  if (!want || typeof want !== "object" || Array.isArray(want)) return false;
  return Object.entries(want as Record<string, unknown>).every(([k, v]) => JSON.stringify(have[k]) === JSON.stringify(v));
};

function recordOp(type: string): "created" | "updated" | "deleted" | undefined {
  return type === "record.created" ? "created" : type === "record.updated" ? "updated" : type === "record.deleted" ? "deleted" : undefined;
}

/** The payload a trigger gives the Run ($trigger): record changes are reshaped, everything else passes through. */
export function triggerPayload(key: string, ev: LoggedEvent): unknown {
  if (key !== "record_change") return ev.payload;
  const p = ev.payload as { recordId?: string; type?: string; fields?: Record<string, unknown>; prev?: Record<string, unknown>; version?: number };
  const op = recordOp(ev.type);
  const fields = p.fields ?? p.prev ?? {};
  return clean({ record: fields, recordId: p.recordId, type: p.type, op, fields: Object.keys(p.fields ?? p.prev ?? {}), changed: op === "updated" ? p.fields : undefined, version: p.version });
}

/** Does this trigger reference match this event? The filter narrows a record change by type, operation, changed field and values. A broken filter is reported, not guessed. */
export function matches(ref: TriggerRef, ev: LoggedEvent): boolean | "filter_error" {
  const def = TRIGGERS.get(ref.key);
  if (!def) return false;
  const src = def.source as { event?: string; events?: string[] };
  const names = src.events ?? (src.event ? [src.event] : []);
  if (!names.includes(ev.type)) return false;
  if (ref.filter === undefined || ref.filter === null) return true;
  if (typeof ref.filter !== "object" || Array.isArray(ref.filter)) return "filter_error";
  const f = ref.filter as Record<string, unknown>;
  if (ref.key === "record_change") {
    const p = ev.payload as { type?: string; fields?: Record<string, unknown>; prev?: Record<string, unknown> };
    if (f.type !== undefined && f.type !== p.type) return false;
    if (f.op !== undefined && f.op !== recordOp(ev.type)) return false;
    if (f.fields !== undefined) {
      if (!Array.isArray(f.fields)) return "filter_error";
      // an update must touch one of the fields; a new record must set one; a delete has no field to look at
      const touched = Object.keys(p.fields ?? {});
      if (ev.type !== "record.deleted" && !f.fields.some((x) => touched.includes(String(x)))) return false;
    }
    if (f.where !== undefined) {
      if (f.where === null || typeof f.where !== "object" || Array.isArray(f.where)) return "filter_error";
      if (!shallowMatch(f.where, { ...(p.prev ?? {}), ...(p.fields ?? {}) })) return false;
    }
    return true;
  }
  return shallowMatch(f, ev.payload);
}

/** One event from the log: start a Run of every enabled Automation it triggers. Importers and sync backfill are skipped unless the Space turned that on. */
export async function consumeEvent(ctx: AutoCtx, ev: LoggedEvent): Promise<{ automationId: string; result: { runId: string } | { dropped: DropReason } }[]> {
  const policy = readPolicy(ctx.db);
  const out: { automationId: string; result: { runId: string } | { dropped: DropReason } }[] = [];
  if (ev.imported && !policy.runOnImport) return out;
  // a draft or an Automation that is off is not listening; a paused one is, so each event it ignores is reported
  for (const a of allAutomations(ctx.db, "status IN ('on', 'paused')")) {
    for (const ref of a.definition.triggers) {
      const m = matches(ref, ev);
      if (m === false) continue;
      if (m === "filter_error") { out.push({ automationId: a.id, result: dropped(ctx, a, "filter_error", ev.id) }); continue; }
      const f: Firing = { trigger: ref.key, eventId: ev.id, payload: triggerPayload(ref.key, ev), origin: ev.origin, depth: ev.depth ?? 0, key: `fire:${a.id}:${ev.id}:${ref.key}` };
      out.push({ automationId: a.id, result: await fireOne(ctx, a, f) });
    }
  }
  return out;
}

