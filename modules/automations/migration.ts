// Cohort migration preview. Publishing a definition never moves active Runs.
// A person reviews groups of Runs that share a version and a current node, then applies only the safe groups.
// Ambiguous groups stay on the version they started on.

export interface MigrationNode {
  id: string;
  key: string;
  effects: "read" | "write" | "outward" | "destructive";
  next?: string[];
}

export interface MigrationRun {
  id: string;
  definitionVersion: number;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped";
  /** The durable step the Run will execute next, or the step it is waiting on. */
  currentStepId: string | null;
  succeededStepIds: readonly string[];
}

export interface Cohort {
  definitionVersion: number;
  currentStepId: string | null;
  runIds: string[];
  disposition: "safe" | "ambiguous" | "inactive";
  proposedStepId: string | null;
  reason: string;
  repeatedEffects: string[];
  skippedEffects: string[];
}

function reachable(nodes: readonly MigrationNode[], from: string | null): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const walk = (id: string | null): void => {
    if (id === null || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    for (const next of byId.get(id)?.next ?? []) walk(next);
  };
  walk(from);
  return seen;
}

function outwardAhead(nodes: readonly MigrationNode[], from: string | null, already: ReadonlySet<string>): string[] {
  const ahead = reachable(nodes, from);
  return nodes.filter((n) => (n.effects === "outward" || n.effects === "destructive") && already.has(n.id) && ahead.has(n.id)).map((n) => n.id);
}

function outwardBehind(source: readonly MigrationNode[], target: readonly MigrationNode[], from: string | null, already: ReadonlySet<string>): string[] {
  const targetIds = new Set(target.map((n) => n.id));
  const ahead = reachable(source, from);
  return source
    .filter((n) => (n.effects === "outward" || n.effects === "destructive") && !already.has(n.id) && ahead.has(n.id) && !targetIds.has(n.id))
    .map((n) => n.id);
}

/** Group active Runs by the version and node they are on. Inactive Runs are reported and never moved. */
export function previewCohorts(runs: readonly MigrationRun[], source: readonly MigrationNode[], target: readonly MigrationNode[]): Cohort[] {
  const targetById = new Map(target.map((n) => [n.id, n]));
  const sourceById = new Map(source.map((n) => [n.id, n]));
  const groups = new Map<string, MigrationRun[]>();
  for (const run of runs) {
    const key = `${run.definitionVersion}\u0000${run.currentStepId ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(run);
    else groups.set(key, [run]);
  }
  const cohorts: Cohort[] = [];
  for (const group of groups.values()) {
    const sample = group[0]!;
    const runIds = group.map((r) => r.id);
    const active = group.some((r) => r.status === "queued" || r.status === "running" || r.status === "waiting");
    if (!active) {
      cohorts.push({
        definitionVersion: sample.definitionVersion, currentStepId: sample.currentStepId, runIds,
        disposition: "inactive", proposedStepId: null, reason: "These Runs already finished. Publishing does not move them.",
        repeatedEffects: [], skippedEffects: [],
      });
      continue;
    }
    const current = sample.currentStepId;
    const targetNode = current ? targetById.get(current) : undefined;
    const sourceNode = current ? sourceById.get(current) : undefined;
    const succeeded = new Set(sample.succeededStepIds);
    if (!current || !targetNode || !sourceNode || targetNode.key !== sourceNode.key) {
      cohorts.push({
        definitionVersion: sample.definitionVersion, currentStepId: current, runIds,
        disposition: "ambiguous", proposedStepId: null,
        reason: current
          ? "The current step is gone or now does different work. Leave these Runs on the version they started on, or review them one by one."
          : "The Run has no current step to land on.",
        repeatedEffects: [], skippedEffects: [],
      });
      continue;
    }
    const repeated = outwardAhead(target, current, succeeded);
    const skipped = outwardBehind(source, target, current, succeeded);
    const risky = repeated.length > 0 || skipped.length > 0;
    cohorts.push({
      definitionVersion: sample.definitionVersion, currentStepId: current, runIds,
      disposition: risky ? "ambiguous" : "safe",
      proposedStepId: current,
      reason: risky
        ? "Landing here would repeat or drop an outward step. Review this group before moving it."
        : "The same step still exists and does the same kind of work. Finished steps stay finished.",
      repeatedEffects: repeated,
      skippedEffects: skipped,
    });
  }
  return cohorts;
}

export interface MigrationPlan { runIds: string[]; toVersion: number; atStepId: string }

/** Apply is refused unless every selected Run sits in a safe cohort. This does not write. */
export function planMigration(cohorts: readonly Cohort[], selectedRunIds: readonly string[], toVersion: number): { ok: true; plans: MigrationPlan[] } | { ok: false; reason: string } {
  const chosen = new Set(selectedRunIds);
  const plans: MigrationPlan[] = [];
  for (const cohort of cohorts) {
    const ids = cohort.runIds.filter((id) => chosen.has(id));
    if (ids.length === 0) continue;
    if (cohort.disposition !== "safe" || !cohort.proposedStepId) {
      return { ok: false, reason: "A selected Run is not in a safe cohort. Leave it pinned or review it on its own." };
    }
    plans.push({ runIds: ids, toVersion, atStepId: cohort.proposedStepId });
  }
  if (plans.length === 0) return { ok: false, reason: "Select at least one Run in a safe cohort." };
  return { ok: true, plans };
}
