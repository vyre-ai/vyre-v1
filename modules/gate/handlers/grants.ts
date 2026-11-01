// Grants (chat design, hole 1): what lets an outward act go without a hold. A grant is a row: person, act, target, and for an automation the hash of the definition it was given for.
// Only a person's press writes one, and it names the outward steps. An agent's save writes none and clears what was there, and the hash voids a row whatever path changed the definition.
// A step with a template where its target goes reaches something new on each Run: a person who wrote that step owns what it computes (row target *), and a person who only pressed Turn on for a step
// an agent wrote allows the targets it names, so a Run reaching another raises a task. Approving that task adds the one target it reached.
import { ANY_TARGET, targetsOf } from "../../../lib/grants.ts";
import { isHostService } from "../../../lib/trust.ts";
import { newHoldId, raise } from "../projections.ts";
import type { GateCtx, Hold, StepRef } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Row { id: string; act: string; target: string; step_id: string | null }
interface StepIn { stepId: string; act: string; targets: string[]; computed: boolean; changed: boolean }

const newGrantId = (): string => `grt_${newHoldId().slice(4)}`;
const rowOut = (r: Row): Record<string, unknown> => ({ id: r.id, act: r.act, target: r.target, ...(r.step_id ? { stepId: r.step_id } : {}) });
const standing = (ctx: GateCtx, automationId: string): Row[] => ctx.db.all("SELECT id, act, target, step_id FROM gate_grants WHERE kind = 'standing' AND subject_id = ?", automationId) as unknown as Row[];

/** The targets of one step after this press. Null keeps nothing for that step. */
function targetsAfter(s: StepIn, kept: string[], press: "save" | "on"): string[] {
  const named = s.targets.length > 0 ? s.targets : s.computed ? [] : [ANY_TARGET];
  if (s.changed) return s.computed ? [...named, ANY_TARGET] : named;      // the person wrote this step
  if (kept.length > 0) return kept;                                        // a grant stands for a step this save did not touch
  return press === "on" ? named : [];                                     // Turn on names the step: it allows what the step names, never what it computes
}

export async function grantsSet(ctx: GateCtx, input: In): Promise<unknown> {
  const by = ctx.principal;
  const pressed = by.kind === "person" || isHostService(by);
  const before = standing(ctx, input.automationId);
  ctx.db.run("DELETE FROM gate_grants WHERE kind = 'standing' AND subject_id = ?", input.automationId);
  if (!pressed) return { grants: [] };                                     // an agent's save: the automation holds nothing until a person presses
  const made: Row[] = [];
  for (const s of input.steps as StepIn[]) {
    const kept = before.filter((r) => r.step_id === s.stepId && r.act === s.act).map((r) => r.target);
    for (const target of new Set(targetsAfter(s, kept, input.press))) {
      const row: Row = { id: newGrantId(), act: s.act, target, step_id: s.stepId };
      ctx.db.run("INSERT INTO gate_grants (id, kind, person, act, target, def_hash, subject_id, step_id, created_at) VALUES (?, 'standing', ?, ?, ?, ?, ?, ?, ?)", row.id, by.id, s.act, target, input.defHash, input.automationId, s.stepId, ctx.now());
      made.push(row);
    }
  }
  return { grants: made.map(rowOut) };
}

/** Does this automation hold this act for this step, on this very definition, for every target the call reaches? A call that names no target needs a row for the step. */
function stepCovered(ctx: GateCtx, step: StepRef, act: string, targets: readonly string[]): boolean {
  const rows = ctx.db.all("SELECT target FROM gate_grants WHERE kind = 'standing' AND subject_id = ? AND def_hash = ? AND step_id = ? AND act = ?", step.automationId, step.defHash, step.nodeId, act) as unknown as { target: string }[];
  if (rows.length === 0) return false;
  const held = new Set(rows.map((r) => r.target));
  return held.has(ANY_TARGET) || (targets.length > 0 && targets.every((t) => held.has(t)));
}

export async function grantsTake(ctx: GateCtx, input: In): Promise<unknown> {
  if (!isHostService(ctx.principal) && !(ctx.origin === "gate" && (ctx.depth ?? 0) === 0)) raise(ctx, "permission.role_lacks_permission", "Only the server asks this.", { reason: "system_only" });
  return { granted: stepCovered(ctx, input.step as StepRef, input.act, input.targets as string[]) };
}

/** A person approved a held step: the automation may reach this target from now on, until its definition changes. A step set to ask before sending asks every time. */
export function addStepTargets(ctx: GateCtx, h: Hold): void {
  const step = h.step;
  if (!step || step.ask === true || ctx.principal.kind !== "person") return;
  const targets = targetsOf(h.input);
  for (const target of targets.length > 0 ? targets : [ANY_TARGET]) {
    ctx.db.run("INSERT INTO gate_grants (id, kind, person, act, target, def_hash, subject_id, step_id, created_at) VALUES (?, 'standing', ?, ?, ?, ?, ?, ?, ?)", newGrantId(), ctx.principal.id, h.act, target, step.defHash, step.automationId, step.nodeId, ctx.now());
  }
}
