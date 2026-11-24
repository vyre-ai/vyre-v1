// Starting Runs of an Automation and the trigger consumer (spec 2.12, 3.7; ARCH 7.7).
// A Run pins the definition version it started on and the principal it acts as (the owner for a Personal Automation, the Automation's own Service principal for a Space one);
// both are kept in automations_runs for the executor. Events that trigger Automations carry `origin` and `depth`: an Automation does not retrigger itself unless allowed, and a chain
// stops at depth 8 (the setting can only lower it).
// DECISION: the depth of an event is the number of Automation hops behind it (0 for a person's or a connector's). `fire` drops depth >= the limit, so the ninth hop never starts.
// DECISION: `automations.stop` without a run id stops every active Run of the Automation and pauses it; with `pause: false` it only stops the Runs.
import { isTrustedService } from "../../../lib/trust.ts";
import { registry } from "../../../generated/registry.ts";
import { validateDefinition, webhookSecretMatches } from "./defs.ts";
import { buttonType, noButtonLine } from "../button.ts";
import { withoutSealed } from "../../../lib/flow-reads.ts";
import {
  allAutomations,
  clean,
  emitAuto,
  findAutomation,
  findDraft,
  findRunLink,
  pastEvents,
  getAutomation,
  isOwner,
  listChildLinks,
  me,
  principalFor,
  raise,
  readPolicy,
  saveRunLink,
  serviceFor,
  touch,
  vaultAllowlist,
  versionDefinition,
} from "../projections.ts";
import type { AutoCtx, Automation, Definition, Policy, RunLink, RunScope, TriggerRef } from "../projections.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TRIGGERS = new Map(registry.triggers.map((t) => [t.key, t] as const));
const rand = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
export type DropReason = "self_trigger" | "depth_limit" | "paused" | "filter_error" | "outsider";

export interface StartOpts {
  trigger: string;
  payload: unknown;
  test: boolean;
  depth: number;
  origin?: string | undefined;
  eventId?: string | undefined;
  version?: number | undefined;
  parentRun?: string | undefined;
  key: string;
  principal?: { kind: "person" | "service"; id: string } | undefined;
  scope?: RunScope | undefined;
  /** Run this draft instead of the pinned version (a test of what the person is looking at). */
  draftDefinition?: Definition | undefined;
  /** Park the new Run before anyone is told it started, so a loop slot does not run ahead of the concurrency cap. */
  hold?: boolean | undefined;
}

/** Create the Run through runs.start, pin the version and principal, say so. Repeating the same key returns the same Run and emits nothing. */
export async function startRun(ctx: AutoCtx, a: Automation, o: StartOpts): Promise<string> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const version = o.version ?? a.version;
  if (versionDefinition(ctx.db, a.id, version) === undefined)
    raise(ctx, "validation.not_found", "That version does not exist.", { reason: "no_version", version });
  const started = (await ctx.call(
    "runs.start",
    clean({
      kind: o.test ? "automation_test" : "automation",
      name: a.name,
      owner: a.ownerId,
      subject: { type: "automation", id: a.id },
      definitionVersion: version,
      parentRun: o.parentRun,
      idempotencyKey: o.key,
    }),
  )) as { runId: string };
  if (findRunLink(ctx.db, started.runId)) return started.runId;
  const link: RunLink = clean({
    runId: started.runId,
    automationId: a.id,
    version,
    trigger: o.trigger,
    test: o.test,
    payload: o.payload,
    depth: o.depth,
    origin: o.origin,
    eventId: o.eventId,
    principal: o.principal ?? principalFor(a),
    parentRun: o.parentRun,
    startedAt: ctx.now(),
    scope: o.scope,
    draftDefinition: o.draftDefinition,
  }) as RunLink;
  saveRunLink(ctx.db, link);
  // A held iteration is waiting before run_started, so the drive consumer finds it parked and leaves it there.
  if (o.hold) await ctx.call("runs.mark_waiting", { runId: started.runId, reason: "background", on: "a loop slot" });
  emitAuto(
    ctx,
    "automation.run_started",
    a.id,
    clean({ runId: started.runId, trigger: o.trigger, version, test: o.test, depth: o.depth, origin: o.origin }),
  );
  return started.runId;
}

/** What the executor needs for a Run: the pinned definition, what started it, the principal and the vault names a Space Automation may use. */
export function loadRunPlan(
  ctx: Pick<AutoCtx, "db">,
  runId: string,
): { link: RunLink; definition: Definition; vault: string[] } | undefined {
  const link = findRunLink(ctx.db, runId);
  if (!link) return undefined;
  const definition = link.draftDefinition ?? versionDefinition(ctx.db, link.automationId, link.version);
  if (!definition) return undefined;
  return {
    link,
    definition,
    vault: link.principal.kind === "service" ? vaultAllowlist(ctx.db, link.automationId) : [],
  };
}

// ---- test, run, retry, replay, stop ----

function usable(ctx: AutoCtx, a: Automation): void {
  if (a.status === "paused")
    raise(ctx, "validation.precondition_failed", a.pausedReason ?? "This automation is paused.", { reason: "paused" });
}

/** A personal automation starts only as its owner. Its own service may start it, and so may a host service (the schedule clock). A Space automation does not use this rule. */
function onlyAsOwner(ctx: AutoCtx, a: Automation): void {
  if (a.kind !== "personal") return;
  if (isOwner(ctx, a) || isTrustedService(ctx.principal)) return;
  if (ctx.principal.kind === "service" && ctx.principal.id === serviceFor(a.id)) return;
  raise(ctx, "permission.not_found", "A personal automation runs only as its owner.");
}
function mustBeValid(ctx: AutoCtx, a: Automation): void {
  const issues = validateDefinition(a.definition, readPolicy(ctx.db));
  const bad = issues.find((i) => i.severity === "error");
  if (bad) raise(ctx, "validation.precondition_failed", bad.message, { reason: "invalid_definition", issues });
}

export async function test(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  onlyAsOwner(ctx, a);
  const key: string = input.trigger ?? a.definition.triggers[0]?.key ?? "manual";
  const def = TRIGGERS.get(key);
  if (!def) raise(ctx, "validation.bad_input", `There is no trigger called ${key}.`);
  // the draft is what the person is looking at: test it, not the last saved version (AUTOMATIONS-BUILD-RC29, 1f)
  const draft = input.draft === true ? findDraft(ctx.db, a.id) : undefined;
  const past = typeof input.eventRunId === "string" ? findRunLink(ctx.db, input.eventRunId) : undefined;
  if (typeof input.eventRunId === "string" && (!past || past.test || past.trigger !== key))
    raise(ctx, "validation.precondition_failed", "That past event is not there any more. Pick another.", {
      reason: "no_event",
    });
  // a real thing that happened (a row of the event log), or a real record as it is now: the Run reads what a live Run would have read
  const real =
    input.sample === undefined && past === undefined
      ? await realPayload(ctx, draft?.definition ?? a.definition, key, input)
      : undefined;
  const runId = await startRun(ctx, a, {
    trigger: real?.trigger ?? key,
    payload: input.sample ?? past?.payload ?? real?.payload ?? def.sample,
    test: true,
    depth: 0,
    version: input.version,
    key: `test:${a.id}:${ctx.now()}:${rand()}`,
    principal: { kind: "person", id: me(ctx) },
    ...(draft ? { draftDefinition: draft.definition } : {}),
  });
  return { runId };
}

/**
 * The payload a test starts from when the person picked something real: one event of the log (`eventId`), or one record (`recordId`), which is read as the newest thing that happened to it, or as it is
 * now when the log holds nothing for it. The trigger is the one of this definition that listens for that event. Nothing is checked against the filter: a test shows what the steps would do with it.
 */
async function realPayload(
  ctx: AutoCtx,
  def: Definition,
  key: string,
  input: In,
): Promise<{ trigger: string; payload: unknown } | undefined> {
  if (!ctx.call || (typeof input.eventId !== "string" && typeof input.recordId !== "string")) return undefined;
  const gone = (): never =>
    raise(ctx, "validation.precondition_failed", "That is not there any more. Pick another.", { reason: "no_event" });
  type Row = { id: string; type: string; at: number; payload: Record<string, unknown> };
  let row: Row | undefined;
  if (typeof input.eventId === "string") {
    row = ((await ctx.call("events.get", { eventId: input.eventId }).catch(() => null)) as { event?: Row } | null)
      ?.event;
    if (!row) gone();
  } else {
    const page = (await ctx
      .call("events.list", { subject: { type: "record", id: input.recordId }, limit: 500 })
      .catch(() => null)) as { events?: Row[] } | null;
    const listened = new Set(def.triggers.flatMap((t) => eventNames(t.key)));
    row = (page?.events ?? []).filter((e) => listened.has(e.type)).sort((x, y) => y.at - x.at)[0];
  }
  if (row) {
    const ev: LoggedEvent = { id: row.id, type: row.type, payload: row.payload ?? {} };
    const ref = def.triggers.find((t) => eventNames(t.key).includes(ev.type));
    const trigger = ref?.key ?? key;
    return { trigger, payload: triggerPayload(trigger, ev) };
  }
  // nothing in the log for this record: it is read as it stands, as a change that touched nothing
  if (typeof input.recordType !== "string") gone();
  const got = (await ctx
    .call("records.get", { type: input.recordType, recordId: input.recordId })
    .catch(() => null)) as {
    record?: { fields?: unknown; version?: number };
  } | null;
  if (!got?.record) gone();
  const trigger = def.triggers.find((t) => t.key === "record_change")?.key ?? key;
  return {
    trigger,
    payload: clean({
      record: withoutSealed(got!.record!.fields),
      recordId: input.recordId,
      type: input.recordType,
      op: "updated",
      fields: [],
      changed: {},
      version: got!.record!.version,
    }),
  };
}
const eventNames = (key: string): string[] => {
  const src = TRIGGERS.get(key)?.source as { event?: string; events?: string[] } | undefined;
  return src?.events ?? (src?.event ? [src.event] : []);
};

/** Real past events a test can be tried on: this trigger's earlier starts, newest first, each with a plain line. */
export async function testEvents(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  onlyAsOwner(ctx, a);
  const key: string = input.trigger ?? a.definition.triggers[0]?.key ?? "manual";
  const links = pastEvents(ctx.db, key, 8, a.id);
  return {
    events: links.map((l) => ({ runId: l.runId, at: l.startedAt, payload: l.payload })),
    sample: TRIGGERS.get(key)?.sample ?? {},
  };
}

/** The origin of a Run an agent started by hand (runs.ts reads it as the trigger "agent_run", which is from outside). */
export const AGENT_RUN_ORIGIN = "agent:";

async function mustHaveButton(ctx: AutoCtx, def: Definition, pressed?: unknown): Promise<void> {
  const type = buttonType(def, pressed);
  const line = type ? await noButtonLine(ctx, type) : undefined;
  if (line) raise(ctx, "validation.precondition_failed", line, { reason: "no_button_field", type });
}

export async function run(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  onlyAsOwner(ctx, a);
  usable(ctx, a);
  mustBeValid(ctx, a);
  const key: string = input.trigger ?? "manual";
  const def = TRIGGERS.get(key);
  if (!def) raise(ctx, "validation.bad_input", `There is no trigger called ${key}.`);
  const manual = "manual" in def.source || "button" in def.source;
  if (!manual)
    raise(ctx, "validation.precondition_failed", "Only the manual and button triggers start by hand.", {
      reason: "not_manual",
      trigger: key,
    });
  const payload =
    key === "manual"
      ? { startedBy: me(ctx), ...(input.payload ? { input: input.payload } : {}) }
      : { pressedBy: me(ctx), ...(input.payload ?? {}) };
  if (key === "button") await mustHaveButton(ctx, a.definition, (payload as { type?: unknown }).type);
  // a Run an agent starts by hand carries what the agent put in its payload, which may be a stranger's text: it counts as from outside (its brief fences it, its task thread is marked)
  const byAgent = ctx.principal.kind === "agent";
  const runId = await startRun(ctx, a, {
    trigger: key,
    payload,
    test: false,
    depth: 0,
    key: `run:${a.id}:${input.idempotencyKey}`,
    ...(byAgent ? { origin: `${AGENT_RUN_ORIGIN}${ctx.principal.id}` } : {}),
  });
  return { runId };
}

export async function retry(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  const old = findRunLink(ctx.db, input.runId);
  if (!old || old.automationId !== a.id)
    raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", {
      reason: "not_a_run_of_this",
    });
  usable(ctx, a);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const from: string | undefined = input.fromStep ?? (await unfinishedStep(ctx, old.runId));
  const r = (await ctx.call("runs.retry", clean({ runId: old.runId, fromStep: input.fromStep }))) as { runId: string };
  if (!findRunLink(ctx.db, r.runId)) {
    await carryFinishedChildren(ctx, old.runId, r.runId, from);
    saveRunLink(
      ctx.db,
      clean({
        ...old,
        runId: r.runId,
        parentRun: old.runId,
        principal: principalFor(a),
        startedAt: ctx.now(),
      }) as RunLink,
    );
    emitAuto(
      ctx,
      "automation.run_started",
      a.id,
      clean({
        runId: r.runId,
        trigger: old.trigger,
        version: old.version,
        test: old.test,
        depth: old.depth,
        origin: old.origin,
      }),
    );
  }
  return { runId: r.runId };
}

/** The step a retry goes on from: the first that did not finish (the same rule as runs.retry). */
async function unfinishedStep(ctx: AutoCtx, runId: string): Promise<string | undefined> {
  try {
    const out = (await ctx.call?.("runs.steps", { runId, limit: 500 })) as {
      steps?: Array<{ step?: string; state?: string }>;
    } | null;
    return out?.steps?.find((s) => s.state !== "succeeded" && s.state !== "skipped")?.step;
  } catch {
    return undefined;
  }
}

/**
 * A loop or parallel step that is retried must not run again the lanes and iterations that succeeded: they may have sent. They move to the new Run, so it counts them as done and starts only what did not finish.
 * The old Run keeps its own step log; its list of children loses the ones that moved.
 */
async function carryFinishedChildren(
  ctx: AutoCtx,
  oldId: string,
  freshId: string,
  step: string | undefined,
): Promise<void> {
  if (!step || !ctx.call) return;
  for (const child of listChildLinks(ctx.db, oldId)) {
    if (child.scope?.containerNodeId !== step) continue;
    const got = (await ctx.call("runs.get", { runId: child.runId })) as { run?: { status?: string } } | null;
    if (got?.run?.status === "succeeded") saveRunLink(ctx.db, { ...child, parentRun: freshId });
  }
}

/**
 * A Run of an Automation retried or replayed through runs.*, as the Runs pages and the notification's Retry button do: it needs what automations.retry gives it, the link to the definition, and the event that
 * drives it. Without them the new Run sat queued for ever. A paused Automation ends the Run at once with the reason, so nothing waits in silence. automations.retry links the Run first, and then this does nothing.
 */
export async function adoptRun(
  ctx: AutoCtx,
  event: {
    name: string;
    payload: {
      runId?: string;
      newRunId?: string;
      fromStep?: string;
      kind?: string;
      parentRun?: string;
      definitionVersion?: number;
    };
  },
): Promise<string | undefined> {
  const p = event.payload;
  const replay = event.name === "run.started" && p.kind === "replay";
  if (event.name === "run.started" && !replay) return undefined;
  const fresh = replay ? p.runId : p.newRunId;
  const oldId = replay ? p.parentRun : p.runId;
  if (!fresh || !oldId || findRunLink(ctx.db, fresh)) return undefined;
  const old = findRunLink(ctx.db, oldId);
  if (!old) return undefined; // not a Run of an Automation
  const a = findAutomation(ctx.db, old.automationId);
  if (!a) return undefined;
  if (a.status === "paused" && !replay) {
    await ctx.call?.("runs.stop", { runId: fresh, reason: a.pausedReason ?? "This automation is paused." });
    return undefined;
  }
  const version = replay && p.definitionVersion === undefined ? a.version : old.version;
  if (!replay) await carryFinishedChildren(ctx, old.runId, fresh, p.fromStep);
  saveRunLink(
    ctx.db,
    clean({
      ...old,
      runId: fresh,
      version,
      parentRun: old.runId,
      principal: principalFor(a),
      startedAt: ctx.now(),
    }) as RunLink,
  );
  emitAuto(
    ctx,
    "automation.run_started",
    a.id,
    clean({
      runId: fresh,
      trigger: old.trigger,
      version,
      test: replay ? true : old.test,
      depth: old.depth,
      origin: old.origin,
    }),
  );
  return fresh;
}

/** A live rerun repeats outward steps. It is not a sandbox replay, so a missing confirmation does not start a run. */
export async function replay(ctx: AutoCtx, input: In): Promise<unknown> {
  if (input.confirm !== true)
    raise(ctx, "validation.precondition_failed", "A live rerun needs confirmation.", { reason: "needs_confirm" });
  const a = getAutomation(ctx, input.automationId);
  const old = findRunLink(ctx.db, input.runId);
  if (!old || old.automationId !== a.id)
    raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", {
      reason: "not_a_run_of_this",
    });
  usable(ctx, a);
  const version = input.version === "current" ? a.version : old.version;
  const runId = await startRun(ctx, a, {
    trigger: old.trigger,
    payload: old.payload,
    test: old.test,
    depth: old.depth,
    origin: old.origin,
    eventId: old.eventId,
    version,
    parentRun: old.runId,
    key: `replay:${old.runId}:${input.version}:${ctx.now()}:${rand()}`,
  });
  return { runId };
}

const ACTIVE_RUN = ["queued", "running", "waiting"] as const;

function childRunIds(db: AutoCtx["db"], root: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([root]);
  const walk = (id: string): void => {
    for (const child of listChildLinks(db, id)) {
      if (seen.has(child.runId)) continue;
      seen.add(child.runId);
      out.push(child.runId);
      walk(child.runId);
    }
  };
  walk(root);
  return out;
}

/** Parents before children, so a child finishing cannot wake a parent this stop is about to end. */
function runsToStop(db: AutoCtx["db"], roots: readonly string[], active: ReadonlySet<string>): string[] {
  const rootSet = new Set(roots);
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    if (rootSet.has(id) || active.has(id)) out.push(id);
    for (const child of listChildLinks(db, id)) visit(child.runId);
  };
  const linked = new Set<string>();
  for (const id of roots) for (const childId of childRunIds(db, id)) linked.add(childId);
  const tops = roots.filter((id) => !linked.has(id));
  for (const id of tops.length ? tops : roots) visit(id);
  for (const id of roots) visit(id);
  return out;
}

function runAlreadyFinished(e: unknown): boolean {
  const err = (e as { error?: { code?: string; details?: { reason?: unknown } } } | null)?.error;
  return err?.code === "validation.precondition_failed" && err.details?.reason === "run_finished";
}

export async function stop(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const listed = (await ctx.call("runs.list", {
    scope: "subject",
    subject: { type: "automation", id: a.id },
    statuses: [...ACTIVE_RUN],
    limit: 500,
  })) as { runs?: { id: string }[] } | null;
  const active = new Set((listed?.runs ?? []).map((x) => x.id));
  let roots: string[];
  if (input.runId) {
    if (findRunLink(ctx.db, input.runId)?.automationId !== a.id)
      raise(ctx, "validation.precondition_failed", "That run does not belong to this automation.", {
        reason: "not_a_run_of_this",
      });
    roots = [input.runId];
  } else roots = [...active];
  // Unfinished children stop with the parent. A child that already finished is not asked again.
  const ids = runsToStop(ctx.db, roots, active);
  let stopped = 0;
  for (const id of ids) {
    try {
      await ctx.call("runs.stop", { runId: id, reason: "Stopped from the automation" });
      stopped += 1;
    } catch (e) {
      if (!runAlreadyFinished(e)) throw e;
    }
  }
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

export interface Firing {
  trigger: string;
  eventId?: string | undefined;
  payload: unknown;
  origin?: string | undefined;
  depth: number;
  key: string;
}

/** The guards between a matched event and a Run: paused, self-trigger, chain depth. Returns the reason an event is dropped, or null. */
export function dropReason(
  a: Automation,
  t: TriggerRef | undefined,
  f: Pick<Firing, "origin" | "depth">,
  policy: Policy,
): DropReason | null {
  if (a.status !== "on") return "paused";
  if (!t) return "filter_error";
  const allowed = a.definition.allowSelfTrigger === true || TRIGGERS.get(t.key)?.allowSelfTrigger === true;
  if (f.origin === `automation:${a.id}` && !allowed) return "self_trigger";
  if (f.depth >= policy.maxChainDepth) return "depth_limit";
  return null;
}

function dropped(
  ctx: AutoCtx,
  a: Automation,
  reason: DropReason,
  eventId: string | undefined,
): { dropped: DropReason } {
  if (eventId) emitAuto(ctx, "automation.trigger_dropped", a.id, { eventId, reason });
  return { dropped: reason };
}

export async function fireOne(
  ctx: AutoCtx,
  a: Automation,
  f: Firing,
): Promise<{ runId: string } | { dropped: DropReason }> {
  const t = a.definition.triggers.find((x) => x.key === f.trigger);
  const why = dropReason(a, t, f, readPolicy(ctx.db));
  if (why) return dropped(ctx, a, why, f.eventId);
  const runId = await startRun(ctx, a, {
    trigger: f.trigger,
    payload: f.payload,
    test: false,
    depth: f.depth,
    origin: f.origin,
    eventId: f.eventId,
    key: f.key,
  });
  return { runId };
}

/**
 * The inbound webhook (POST /hooks/automation/<id>/<secret>): the host route has read the body and rate-limited the source, and asks here.
 * Answers null for every refusal (unknown, deleted, turned off, no webhook trigger, a Personal Space, a wrong or rotated secret) so a caller learns nothing about which it was.
 * The body is the trigger data. The same Idempotency-Key starts one Run.
 */
export async function acceptHook(
  ctx: AutoCtx,
  input: { automationId?: unknown; secret?: unknown; payload?: unknown; idempotencyKey?: unknown },
): Promise<{ accepted: true; runId?: string } | null> {
  const id = typeof input.automationId === "string" ? input.automationId : "";
  const secret = typeof input.secret === "string" ? input.secret : "";
  if (!/^aut_[a-z0-9]+$/.test(id) || secret === "") return null;
  const found = findAutomation(ctx.db, id);
  if (!found) return null;
  const match = webhookSecretMatches(ctx, id, secret);
  if (!match) return null;
  if (
    found.status !== "on" ||
    !found.definition.triggers.some((t) => t.key === "webhook") ||
    readPolicy(ctx.db).personalSpace
  )
    return null;
  const given =
    typeof input.idempotencyKey === "string" && input.idempotencyKey !== "" && input.idempotencyKey.length <= 200
      ? input.idempotencyKey
      : "";
  const fired = await fireOne(ctx, found, {
    trigger: "webhook",
    payload: input.payload ?? null,
    depth: 0,
    eventId: given ? `hook:${given}` : undefined,
    key: `hook:${id}:${given || `${ctx.now()}-${rand()}${rand()}`}`,
  });
  return "runId" in fired ? { accepted: true, runId: fired.runId } : { accepted: true };
}

export async function fire(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  onlyAsOwner(ctx, a);
  if (!TRIGGERS.has(input.trigger)) raise(ctx, "validation.bad_input", `There is no trigger called ${input.trigger}.`);
  if (!a.definition.triggers.some((x) => x.key === input.trigger))
    raise(ctx, "validation.precondition_failed", "This automation does not use that trigger.", {
      reason: "no_such_trigger",
      trigger: input.trigger,
    });
  const r = await fireOne(ctx, a, {
    trigger: input.trigger,
    eventId: input.eventId,
    payload: input.payload,
    origin: input.origin,
    depth: input.depth,
    key: `fire:${a.id}:${input.eventId ?? input.idempotencyKey}`,
  });
  return r;
}

// ---- the consumer: events in, Runs out ----

export interface LoggedEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  origin?: string;
  depth?: number;
  /** written by an importer or sync backfill */ imported?: boolean;
  /** the person who caused it has no standing in the Space (a guest) */
  outsider?: boolean;
}

function recordOp(type: string): "created" | "updated" | "deleted" | undefined {
  return type === "record.created"
    ? "created"
    : type === "record.updated"
      ? "updated"
      : type === "record.deleted"
        ? "deleted"
        : undefined;
}

/** The payload a trigger gives the Run ($trigger): record changes are reshaped, everything else passes through. */
export function triggerPayload(key: string, ev: LoggedEvent): unknown {
  if (key !== "record_change") return ev.payload;
  const p = ev.payload as {
    recordId?: string;
    type?: string;
    fields?: Record<string, unknown>;
    prev?: Record<string, unknown>;
    version?: number;
  };
  const op = recordOp(ev.type);
  const fields = p.fields ?? p.prev ?? {};
  return clean({
    record: withoutSealed(fields),
    recordId: p.recordId,
    type: p.type,
    op,
    fields: Object.keys(p.fields ?? p.prev ?? {}),
    changed: op === "updated" ? withoutSealed(p.fields) : undefined,
    version: p.version,
  });
}

/** One thing a trigger's filter looked at on an event, and whether the event passed it. */
export interface MatchCheck {
  ok: boolean;
  /** type, op and fields are the record filter's own keys; where is one of its field values; value is one key of any other trigger's filter */
  key: "type" | "op" | "fields" | "where" | "value";
  field?: string;
  want?: unknown;
  got?: unknown;
}
export interface MatchResult {
  /** the trigger listens for this kind of event at all */ listens: boolean;
  ok: boolean;
  /** the filter itself is broken */ error?: true;
  /** what was looked at, in the order it was looked at; the last one is the one that stopped it when `ok` is false */
  checks: MatchCheck[];
}

/**
 * Why a trigger reference does or does not match an event: every part of the filter that was looked at, in order, ending at the first that did not hold. `matches` below is this, as one word, so the
 * consumer that starts Runs and the page that says why one did not start can never disagree.
 */
export function explainMatch(ref: TriggerRef, ev: LoggedEvent): MatchResult {
  const def = TRIGGERS.get(ref.key);
  if (!def) return { listens: false, ok: false, checks: [] };
  const src = def.source as { event?: string; events?: string[] };
  const names = src.events ?? (src.event ? [src.event] : []);
  if (!names.includes(ev.type)) return { listens: false, ok: false, checks: [] };
  if (ref.filter === undefined || ref.filter === null) return { listens: true, ok: true, checks: [] };
  const checks: MatchCheck[] = [];
  const broken: MatchResult = { listens: true, ok: false, error: true, checks };
  if (typeof ref.filter !== "object" || Array.isArray(ref.filter)) return broken;
  const f = ref.filter as Record<string, unknown>;
  const no = (c: Omit<MatchCheck, "ok">): MatchResult => {
    checks.push({ ...c, ok: false });
    return { listens: true, ok: false, checks };
  };
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (ref.key === "record_change") {
    const p = ev.payload as { type?: string; fields?: Record<string, unknown>; prev?: Record<string, unknown> };
    if (f.type !== undefined) {
      if (f.type !== p.type) return no({ key: "type", want: f.type, got: p.type });
      checks.push({ ok: true, key: "type", want: f.type });
    }
    if (f.op !== undefined) {
      const op = recordOp(ev.type);
      if (f.op !== op) return no({ key: "op", want: f.op, got: op });
      checks.push({ ok: true, key: "op", want: f.op });
    }
    if (f.fields !== undefined) {
      if (!Array.isArray(f.fields)) return broken;
      // an update must touch one of the fields; a new record must set one; a delete has no field to look at
      const touched = Object.keys(p.fields ?? {});
      if (ev.type !== "record.deleted" && !f.fields.some((x) => touched.includes(String(x))))
        return no({ key: "fields", want: f.fields, got: touched });
      checks.push({ ok: true, key: "fields", want: f.fields, got: touched });
    }
    if (f.where !== undefined) {
      if (f.where === null || typeof f.where !== "object" || Array.isArray(f.where)) return broken;
      const have: Record<string, unknown> = { ...(p.prev ?? {}), ...(p.fields ?? {}) };
      for (const [k, v] of Object.entries(f.where as Record<string, unknown>)) {
        if (!same(have[k], v)) return no({ key: "where", field: k, want: v, got: have[k] });
        checks.push({ ok: true, key: "where", field: k, want: v });
      }
    }
    return { listens: true, ok: true, checks };
  }
  for (const [k, v] of Object.entries(f)) {
    if (!same(ev.payload[k], v)) return no({ key: "value", field: k, want: v, got: ev.payload[k] });
    checks.push({ ok: true, key: "value", field: k, want: v });
  }
  return { listens: true, ok: true, checks };
}

/** Does this trigger reference match this event? The filter narrows a record change by type, operation, changed field and values. A broken filter is reported, not guessed. */
export function matches(ref: TriggerRef, ev: LoggedEvent): boolean | "filter_error" {
  const r = explainMatch(ref, ev);
  return r.error ? "filter_error" : r.listens && r.ok;
}

// A bulk import or a runaway chain must not start thousands of Runs: past BURST_LIMIT event starts of one Flow in BURST_WINDOW_MS the Flow is paused, and its owner gets a Needs you note saying so and how to go on.
export const BURST_LIMIT = 100;
export const BURST_WINDOW_MS = 60_000;
const STARTS = new Map<string, number[]>();
/** Count this start for the Automation; true once it is past the limit. */
export function overBurst(automationId: string, now: number): boolean {
  const recent = (STARTS.get(automationId) ?? []).filter((t) => now - t < BURST_WINDOW_MS);
  recent.push(now);
  STARTS.set(automationId, recent);
  return recent.length > BURST_LIMIT;
}
export const resetBursts = (): void => STARTS.clear();

async function pauseForBurst(ctx: AutoCtx, a: Automation): Promise<void> {
  if (a.status !== "on") return;
  a.status = "paused";
  a.pausedReason = `Paused: more than ${BURST_LIMIT} starts in a minute, as a bulk import would cause. Check it, then turn it back on.`;
  touch(ctx, a);
  emitAuto(ctx, "automation.disabled", a.id, { reason: a.pausedReason });
  if (!ctx.call) return;
  try {
    await ctx.call("tasks.create", {
      kind: "unblock",
      title: `${a.name} was paused`,
      summary: a.pausedReason,
      why: "Too many things started it at once, so it stopped before starting thousands of Runs.",
      assigned: { kind: "person", id: a.ownerId },
      source: { kind: "manual", id: `flow:${a.id}` },
      idempotencyKey: `flow-burst:${a.id}:${ctx.now()}`,
    });
  } catch {
    /* the pause stands and shows on the Flow even if the note could not be made */
  }
}

/** One event from the log: start a Run of every enabled Automation it triggers. Importers and sync backfill are skipped unless the Space turned that on. */
/**
 * What a record's event is to one Automation: the event as its owner may see it. An Automation runs for a person (its owner, or whom it runs as) and receives the record in its trigger; that person
 * sees only the fields their grants let them see, so the filter, the trigger payload and every step read only those (a step could otherwise write a hidden value where the person can read it, and a filter on
 * a hidden field would tell them its value). A record the person may not see at all starts nothing, and nothing says that it exists. A deletion cannot be judged (the record is gone): it starts the Automation
 * with no values. The host's field rule answers (ctx.recordFieldGate); a hand-built ctx without it keeps the event whole.
 */
async function eventForOwner(
  ctx: AutoCtx,
  a: Automation,
  ev: LoggedEvent,
  gates: Map<string, ((field: string) => boolean) | null>,
): Promise<LoggedEvent | null> {
  const op = recordOp(ev.type);
  const p = ev.payload as { recordId?: unknown; type?: unknown; fields?: unknown; prev?: unknown };
  if (op === undefined || !ctx.recordFieldGate || typeof p.recordId !== "string" || typeof p.type !== "string")
    return ev;
  const person = a.runsAs ?? a.ownerId;
  const key = `${person}\u0000${p.type}\u0000${p.recordId}`;
  let gate = gates.get(key);
  if (gate === undefined) {
    gate = await ctx.recordFieldGate(person, p.type, p.recordId).catch(() => null);
    gates.set(key, gate);
  }
  if (gate === null && op !== "deleted") return null;
  const keep = gate ?? (() => false);
  const cut = (v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([f]) => keep(f)))
      : v;
  return { ...ev, payload: { ...ev.payload, ...("fields" in p ? { fields: cut(p.fields) } : {}), ...("prev" in p ? { prev: cut(p.prev) } : {}) } };
}

export async function consumeEvent(
  ctx: AutoCtx,
  ev: LoggedEvent,
): Promise<{ automationId: string; result: { runId: string } | { dropped: DropReason } }[]> {
  const policy = readPolicy(ctx.db);
  const out: { automationId: string; result: { runId: string } | { dropped: DropReason } }[] = [];
  if (ev.imported && !policy.runOnImport) return out;
  // a write that says it is quiet (a system move, such as a Journey migration) starts nothing, whatever listens for it
  if ((ev.payload as { quiet?: unknown } | undefined)?.quiet === true) return out;
  // a draft or an Automation that is off is not listening; a paused one is, so each event it ignores is reported
  const gates = new Map<string, ((field: string) => boolean) | null>();
  for (const a of allAutomations(ctx.db, "status IN ('on', 'paused')")) {
    // the event as this Automation's person may see it; a record they may not see starts nothing (and is not reported: that would say it exists)
    const seen = a.definition.triggers.some((t) => t.key === "record_change") ? await eventForOwner(ctx, a, ev, gates) : ev;
    if (seen === null) continue;
    for (const ref of a.definition.triggers) {
      const m = matches(ref, ref.key === "record_change" ? seen : ev);
      if (m === false) continue;
      if (m === "filter_error") {
        out.push({ automationId: a.id, result: dropped(ctx, a, "filter_error", ev.id) });
        continue;
      }
      // not run: caused by a guest. An Automation runs under its own standing, which reaches what its owner's does; a person with no standing in the Space does not start one by posting a message, changing a
      // record, a sheet row or a Journey stage (an opt-in on the trigger, set by the Automation's owner, would be one more condition here). Their words are never instructions to a step.
      if (ev.outsider === true) {
        out.push({ automationId: a.id, result: dropped(ctx, a, "outsider", ev.id) });
        continue;
      }
      if (a.status === "on" && overBurst(a.id, ctx.now())) {
        await pauseForBurst(ctx, a);
        out.push({ automationId: a.id, result: dropped(ctx, a, "paused", ev.id) });
        continue;
      }
      const f: Firing = {
        trigger: ref.key,
        eventId: ev.id,
        payload: triggerPayload(ref.key, ref.key === "record_change" ? seen : ev),
        origin: ev.origin,
        depth: ev.depth ?? 0,
        key: `fire:${a.id}:${ev.id}:${ref.key}`,
      };
      out.push({ automationId: a.id, result: await fireOne(ctx, a, f) });
    }
  }
  return out;
}
