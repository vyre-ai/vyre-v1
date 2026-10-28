// Reviewed cohort apply. Preview groups active Runs. Apply moves only the safe ones.
// The executor pin is automations_runs.version. The visible pin is runs_items.definition_version.
// Pin happens first. A failed pin does not save a new link. Finished steps are not replayed.
import { registry } from "../../../generated/registry.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { planMigration, previewCohorts } from "../migration.ts";
import type { Cohort, MigrationNode, MigrationRun } from "../migration.ts";
import { canView } from "./defs.ts";
import {
  clean, emitAuto, findRunLink, getAutomation, isOwner, raise, saveRunLink, versionDefinition,
} from "../projections.ts";
import type { AutoCtx, Automation, Definition, Node } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const EFFECTS = new Map(registry.steps.map((s) => [s.key, s.effects] as const));
const STATUSES = new Set(["queued", "running", "waiting", "succeeded", "failed", "stopped"]);
const ACTIVE = new Set(["queued", "running", "waiting"]);

function effectsOf(key: string): MigrationNode["effects"] {
  const hit = EFFECTS.get(key);
  if (hit === "read" || hit === "write" || hit === "outward") return hit;
  return "outward";
}

function nodesOf(def: Definition): MigrationNode[] {
  return def.nodes.map((n: Node) => ({ id: n.id, key: n.key, effects: effectsOf(n.key), ...(n.next ? { next: n.next } : {}) }));
}

function editable(ctx: AutoCtx, a: Automation): Automation {
  if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
  if (isTrustedService(ctx.principal) || isOwner(ctx, a)) return a;
  const allow = (level: "edit" | "manage"): boolean => ctx.authorize?.({ perm: null, level }, { type: "automation", id: a.id }).effect === "allow";
  if (allow("edit") || allow("manage")) return a;
  raise(ctx, "permission.role_lacks_permission", "Only someone who can edit this automation can move its runs.", { reason: "edit_required" });
}

interface ListedRun { id?: unknown; status?: unknown; definitionVersion?: unknown }
interface StepRow { step?: unknown; state?: unknown }

function currentOf(steps: readonly StepRow[]): { currentStepId: string | null; succeededStepIds: string[] } {
  const newest = new Map<string, string>();
  for (const row of steps) {
    if (typeof row.step !== "string" || typeof row.state !== "string") continue;
    newest.set(row.step, row.state);
  }
  const succeeded: string[] = [];
  let current: string | null = null;
  for (const [step, state] of newest) {
    if (state === "succeeded") succeeded.push(step);
    if (state === "running" || state === "waiting" || state === "failed" || state === "pending") current = step;
  }
  return { currentStepId: current, succeededStepIds: succeeded };
}

async function loadRuns(ctx: AutoCtx, a: Automation): Promise<MigrationRun[]> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const rows: ListedRun[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const listed = await ctx.call("runs.list", clean({
      scope: "subject", subject: { type: "automation", id: a.id }, limit: 500, ...(cursor ? { cursor } : {}),
    })) as { runs?: ListedRun[]; next?: string };
    const batch = listed?.runs ?? [];
    for (const row of batch) {
      if (typeof row.id !== "string" || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (!listed?.next || batch.length === 0 || listed.next === cursor) break;
    cursor = listed.next;
  }
  const runs: MigrationRun[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string" || !STATUSES.has(row.status)) continue;
    const link = findRunLink(ctx.db, row.id);
    if (link && link.automationId !== a.id) continue;
    const version = link?.version ?? (typeof row.definitionVersion === "number" ? row.definitionVersion : a.version);
    let steps: StepRow[] = [];
    try {
      const got = await ctx.call("runs.steps", { runId: row.id }) as { steps?: StepRow[] };
      steps = got?.steps ?? [];
    } catch { steps = []; }
    const { currentStepId, succeededStepIds } = currentOf(steps);
    runs.push({ id: row.id, definitionVersion: version, status: row.status as MigrationRun["status"], currentStepId, succeededStepIds });
  }
  return runs;
}

function cohortsFor(ctx: AutoCtx, a: Automation, runs: readonly MigrationRun[], toVersion: number): Cohort[] {
  const targetDef = versionDefinition(ctx.db, a.id, toVersion);
  if (!targetDef) raise(ctx, "validation.not_found", "That version does not exist.", { reason: "no_version", version: toVersion });
  const target = nodesOf(targetDef);
  const byVersion = new Map<number, MigrationRun[]>();
  for (const run of runs) {
    const list = byVersion.get(run.definitionVersion);
    if (list) list.push(run);
    else byVersion.set(run.definitionVersion, [run]);
  }
  const cohorts: Cohort[] = [];
  for (const [version, group] of byVersion) {
    const sourceDef = versionDefinition(ctx.db, a.id, version);
    if (!sourceDef) {
      const active = group.some((run) => ACTIVE.has(run.status));
      cohorts.push({
        definitionVersion: version, currentStepId: group[0]?.currentStepId ?? null, runIds: group.map((run) => run.id),
        disposition: active ? "ambiguous" : "inactive", proposedStepId: null,
        reason: "The definition version these Runs started on is missing. Leave them pinned.",
        repeatedEffects: [], skippedEffects: [],
      });
      continue;
    }
    cohorts.push(...previewCohorts(group, nodesOf(sourceDef), target));
  }
  return cohorts;
}

export async function migrationPreview(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
  const toVersion = input.toVersion;
  if (typeof toVersion !== "number" || !Number.isInteger(toVersion) || toVersion < 1) raise(ctx, "validation.bad_input", "A definition version is a whole number.");
  return { cohorts: cohortsFor(ctx, a, await loadRuns(ctx, a), toVersion) };
}

export async function migrateRuns(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = editable(ctx, getAutomation(ctx, input.automationId));
  const toVersion = input.toVersion;
  if (typeof toVersion !== "number" || !Number.isInteger(toVersion) || toVersion < 1) raise(ctx, "validation.bad_input", "A definition version is a whole number.");
  const requested = Array.isArray(input.runIds) ? input.runIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const runs = await loadRuns(ctx, a);
  const known = new Set(runs.map((run) => run.id));
  if (requested.some((id) => !known.has(id))) raise(ctx, "validation.precondition_failed", "A selected Run is not a run of this automation.", { reason: "not_a_run_of_this" });
  const plan = planMigration(cohortsFor(ctx, a, runs, toVersion), requested, toVersion);
  if (!plan.ok) raise(ctx, "validation.precondition_failed", plan.reason, { reason: "unsafe_cohort" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const moved: { runId: string; fromVersion: number; toVersion: number; atStepId: string }[] = [];
  const say = (): void => {
    if (moved.length === 0) return;
    emitAuto(ctx, "automation.runs_migrated", a.id, { toVersion, runIds: moved.map((row) => row.runId) });
  };
  try {
    for (const item of plan.plans) {
      for (const runId of item.runIds) {
        const link = findRunLink(ctx.db, runId);
        if (link && link.automationId !== a.id) continue;
        const row = runs.find((run) => run.id === runId);
        const fromVersion = link?.version ?? row?.definitionVersion ?? a.version;
        if (fromVersion === toVersion) continue;
        await ctx.call("runs.pin_version", { runId, definitionVersion: toVersion });
        if (link) saveRunLink(ctx.db, { ...link, version: toVersion });
        moved.push({ runId, fromVersion, toVersion, atStepId: item.atStepId });
      }
    }
  } catch (e) {
    say();
    throw e;
  }
  say();
  return { moved };
}
