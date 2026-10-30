// This Space's switcher tile and the first-run checklist (spec 2.1, 3.13). The tile carries needsYou: the client shows a red dot on any other Space whose tile reports more than zero.
import type { SpacesCtx, Step } from "../projections.ts";
import { STEPS, completeStep, doneSteps, me, raise } from "../projections.ts";

const ok = { ok: true } as const;

export async function switcher(ctx: SpacesCtx, _input: Record<string, never>) {
  const person = me(ctx);
  const row = ctx.db.all(`SELECT name, logo_file_id, kind FROM spaces_profile WHERE id = ?`, ctx.space)[0] as { name: string; logo_file_id: string | null; kind: "personal" | "team" } | undefined;
  if (!row) raise(ctx.trace.traceId, "validation.not_found", "this Space has no profile yet");
  const a = (await ctx.attention?.of(person)) ?? { needsYou: 0, unread: 0 };
  return {
    name: row.name,
    ...(row.logo_file_id ? { logoFileId: row.logo_file_id } : {}),
    kind: row.kind,
    role: ctx.directory?.roleName(person) ?? "member",
    needsYou: Math.max(0, Math.trunc(a.needsYou)),
    unread: Math.max(0, Math.trunc(a.unread)),
  };
}

export async function onboardingGet(ctx: SpacesCtx, _input: Record<string, never>) {
  const person = me(ctx);
  const done = doneSteps(ctx, person);
  const dismissed = ctx.db.all(`SELECT dismissed_at FROM spaces_onboarding_state WHERE person = ?`, person).length > 0;
  return { dismissed, steps: STEPS.map((s) => ({ key: s.key, title: s.title, done: done.has(s.key) })) };
}

export async function onboardingComplete(ctx: SpacesCtx, input: { step: Step }) {
  const person = me(ctx);
  if (!STEPS.some((s) => s.key === input.step)) raise(ctx.trace.traceId, "validation.bad_input", "unknown checklist step");
  completeStep(ctx, person, input.step);
  return ok;
}

export async function onboardingDismiss(ctx: SpacesCtx, _input: Record<string, never>) {
  const person = me(ctx);
  if (ctx.db.all(`SELECT dismissed_at FROM spaces_onboarding_state WHERE person = ?`, person).length > 0) return ok;
  ctx.db.run(`INSERT INTO spaces_onboarding_state (person, dismissed_at) VALUES (?, ?)`, person, ctx.now());
  ctx.emit("onboarding.dismissed", person, { person });
  return ok;
}

const FLOWS = new Set(["personal", "team", "member"]);
const STEP_KEY = /^[a-z][a-z_]{0,23}$/;
function flowOf(ctx: SpacesCtx, flow: string): string {
  if (!FLOWS.has(flow)) raise(ctx.trace.traceId, "validation.bad_input", "unknown onboarding flow");
  return flow;
}

/** The onboarding screen's progress for one flow. The client owns the list of steps; the server keeps only what a person marked, so a new step needs no migration. */
export async function onboardingFlow(ctx: SpacesCtx, input: { flow: string }) {
  const person = me(ctx);
  const flow = flowOf(ctx, input.flow);
  const rows = ctx.db.all(`SELECT step, state, at FROM spaces_onboarding_flow WHERE person = ? AND flow = ? ORDER BY at`, person, flow) as { step: string; state: "done" | "later" }[];
  const seen = ctx.db.all(`SELECT at FROM spaces_onboarding_seen WHERE person = ? AND flow = ?`, person, flow).length > 0;
  return { seen, steps: rows.map((r) => ({ key: r.step, state: r.state })) };
}

export async function onboardingMark(ctx: SpacesCtx, input: { flow: string; step: string; state: "done" | "later" | "open" }) {
  const person = me(ctx);
  const flow = flowOf(ctx, input.flow);
  if (!STEP_KEY.test(input.step)) raise(ctx.trace.traceId, "validation.bad_input", "unknown onboarding step");
  if (input.state === "open") ctx.db.run(`DELETE FROM spaces_onboarding_flow WHERE person = ? AND flow = ? AND step = ?`, person, flow, input.step);
  else ctx.db.run(`INSERT OR REPLACE INTO spaces_onboarding_flow (person, flow, step, state, at) VALUES (?, ?, ?, ?, ?)`, person, flow, input.step, input.state, ctx.now());
  return ok;
}

export async function onboardingSeen(ctx: SpacesCtx, input: { flow: string }) {
  const person = me(ctx);
  const flow = flowOf(ctx, input.flow);
  ctx.db.run(`INSERT OR REPLACE INTO spaces_onboarding_seen (person, flow, at) VALUES (?, ?, ?)`, person, flow, ctx.now());
  return ok;
}
