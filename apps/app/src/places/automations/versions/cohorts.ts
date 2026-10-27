// Active runs stay on the definition version they started with. Migration is not applied from this screen.
export interface CohortRun {
  id: string;
  definitionVersion?: number;
  status: string;
  summary?: string;
}

export interface CohortStep {
  step: string;
  state: string;
}

export interface CohortMember {
  id: string;
  status: string;
  summary?: string;
  step?: string;
  state?: string;
}

export interface Cohort {
  version: number;
  current: boolean;
  runs: CohortMember[];
}

export function cohortsOf(currentVersion: number, runs: readonly CohortRun[], stepsByRun: Readonly<Record<string, readonly CohortStep[]>>): Cohort[] {
  const by = new Map<number, Cohort>();
  for (const run of runs) {
    const version = typeof run.definitionVersion === "number" ? run.definitionVersion : currentVersion;
    let cohort = by.get(version);
    if (!cohort) {
      cohort = { version, current: version === currentVersion, runs: [] };
      by.set(version, cohort);
    }
    const steps = stepsByRun[run.id] ?? [];
    const current = [...steps].reverse().find((step) => step.state === "running" || step.state === "waiting" || step.state === "failed" || step.state === "pending") ?? steps[steps.length - 1];
    cohort.runs.push({
      id: run.id,
      status: run.status,
      ...(run.summary ? { summary: run.summary } : {}),
      ...(current ? { step: current.step, state: current.state } : {}),
    });
  }
  return [...by.values()].sort((a, b) => b.version - a.version);
}

export function cohortPreview(member: CohortMember): string {
  if (!member.step) return "Current node is not in the step log. Next step is not in the step log.";
  return `Current node ${member.step} (${member.state ?? "unknown"}). Next step is the following row in the step log when one was recorded.`;
}

export interface VersionedDefinition {
  version: number;
  draftVersion?: number;
  liveVersion?: number;
}

/** The API has no draft field unless the record actually carries one. No invented edit count. */
export function definitionLabel(record: VersionedDefinition): string {
  const live = typeof record.liveVersion === "number" ? record.liveVersion : record.version;
  if (typeof record.draftVersion === "number" && record.draftVersion !== live) return `Live v${live} · Draft differs`;
  return `Current definition v${live}`;
}

export const MIGRATION_DISABLED = "Applying a migration is a separate reviewed action.";
