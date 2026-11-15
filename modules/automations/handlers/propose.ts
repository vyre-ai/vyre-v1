// Building by asking (AUTOMATIONS-BUILD-RC29 phase 2; design AUTOMATIONS-2026-11-13 2.7, 2.8 rule R3).
// An Assistant puts steps on the page as a proposal. Nothing proposed is saved as the definition, made live or turned on: a person reads it and presses Accept.
// Proposing is the one write an Assistant needs to build an Automation; accepting is a person's act and an agent is refused.
import { emitAuto, findDraft, getAutomation, me, out, raise } from "../projections.ts";
import type { AutoCtx, Automation, Definition } from "../projections.ts";
import { dropProposal, findProposal, proposalOut, writeProposal } from "../proposals.ts";
import { canView, checkStructure, create, draftSave, mustChange, refuseSecret, remove, validate } from "./defs.ts";

type In = Record<string, unknown>;

const SUMMARY_MAX = 200;
const MOVED = "This Automation changed after the draft was made. Ask for a new draft.";
const PERSON_ONLY = "A person accepts a draft. Tell them it is ready and what it does.";

function seen(ctx: AutoCtx, a: Automation): Automation {
  if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
  return a;
}

function answer(ctx: AutoCtx, a: Automation, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const d = findDraft(ctx.db, a.id);
  const p = findProposal(ctx.db, a.id);
  return {
    automation: out(a),
    ...(d ? { draft: { definition: d.definition, rev: d.rev, baseVersion: d.baseVersion, by: d.by, at: d.at } } : {}),
    ...(p ? { proposal: proposalOut(p) } : {}),
    ...extra,
  };
}

const emptyOf = (def: Definition | undefined): boolean => !def || !Array.isArray(def.nodes) || def.nodes.length === 0;

/**
 * Put steps on the page as a proposal. With no automationId, an empty Automation that is off is made first (so the work has a row in the list and is not lost if the person
 * leaves), and the proposal attaches to it. The answer carries what is still missing, in the same words the page shows, so the Assistant asks for exactly that.
 */
export async function propose(ctx: AutoCtx, input: In): Promise<unknown> {
  const def = input.definition as Definition;
  checkStructure(ctx, def);
  refuseSecret(ctx, def);
  const summary = typeof input.summary === "string" ? input.summary.trim().slice(0, SUMMARY_MAX) : "";
  if (!summary)
    raise(
      ctx,
      "validation.bad_input",
      "Say in one line what the steps do, so the person can read it before accepting.",
      {
        reason: "no_summary",
      },
    );
  let a: Automation;
  let madeShell = false;
  if (typeof input.automationId === "string" && input.automationId) {
    a = seen(ctx, getAutomation(ctx, String(input.automationId)));
    await mustChange(ctx, a);
    madeShell = findProposal(ctx.db, a.id)?.madeShell === true && emptyOf(a.definition) && a.version === 1;
  } else {
    const made = (await create(ctx, { name: input.name })) as { automation: { id: string } };
    a = getAutomation(ctx, made.automation.id);
    madeShell = true;
  }
  const d = findDraft(ctx.db, a.id);
  writeProposal(ctx.db, a.id, {
    definition: def,
    summary,
    by: ctx.principal.id,
    forWho: me(ctx),
    baseVersion: a.version,
    baseRev: d?.rev ?? 0,
    madeShell,
    at: ctx.now(),
  });
  emitAuto(ctx, "automation.updated", a.id, { version: a.version, fields: ["proposal"] });
  const checked = (await validate(ctx, { definition: def })) as { ok: boolean; issues: unknown[] };
  return answer(ctx, a, { ok: checked.ok, issues: checked.issues });
}

/** A person takes the proposal: an off Automation saves it, an on one keeps it as their draft until Make live. An agent is refused. */
export async function proposalAccept(ctx: AutoCtx, input: In): Promise<unknown> {
  if (ctx.principal.kind !== "person")
    raise(ctx, "validation.precondition_failed", PERSON_ONLY, { reason: "person_only" });
  const a = seen(ctx, getAutomation(ctx, String(input.automationId)));
  await mustChange(ctx, a);
  const p = findProposal(ctx.db, a.id);
  if (!p) return answer(ctx, a);
  const d = findDraft(ctx.db, a.id);
  if (p.baseVersion !== a.version || p.baseRev !== (d?.rev ?? 0))
    raise(ctx, "validation.version_conflict", MOVED, { current: a.version, expected: p.baseVersion });
  await draftSave(ctx, {
    automationId: a.id,
    definition: p.definition,
    expectedVersion: a.version,
    ...(d ? { expectedRev: d.rev } : {}),
  });
  dropProposal(ctx.db, a.id);
  const after = getAutomation(ctx, a.id);
  emitAuto(ctx, "automation.updated", a.id, { version: after.version, fields: ["proposal"] });
  return answer(ctx, after);
}

/**
 * Throw the proposal away: a person who may change the Automation, or the Assistant that made it. When proposing made the Automation and nothing else was ever put in it, the
 * empty Automation goes to Trash with it, so a discarded idea leaves no empty row behind.
 */
export async function proposalDiscard(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = seen(ctx, getAutomation(ctx, String(input.automationId)));
  const p = findProposal(ctx.db, a.id);
  if (!p) return answer(ctx, a);
  if (ctx.principal.id !== p.by) await mustChange(ctx, a);
  dropProposal(ctx.db, a.id);
  if (p.madeShell && a.version === 1 && emptyOf(a.definition) && a.status !== "on" && !findDraft(ctx.db, a.id)) {
    await remove(ctx, { automationId: a.id });
    return { automation: out(getAutomation(ctx, a.id, true)), removed: true };
  }
  emitAuto(ctx, "automation.updated", a.id, { version: a.version, fields: ["proposal"] });
  return answer(ctx, a);
}
