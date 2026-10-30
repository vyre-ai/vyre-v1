// Active runs stay on the definition version they started with until a reviewed Apply moves a safe group.
import { DRAFT_HAS_EDITS } from "../chrome.ts";
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
  status?: string;
  draftVersion?: number;
  liveVersion?: number;
}

/** Live only when the record has a live version or is on. Draft edits only when the draft differs or the canvas is dirty. No edit count. */
export function definitionLabel(record: VersionedDefinition, dirty = false): string {
  const liveKnown = typeof record.liveVersion === "number";
  const live = liveKnown ? record.liveVersion : record.version;
  const showLive = liveKnown || record.status === "on";
  const head = showLive ? `Live v${live}` : `v${record.version}`;
  const draftDiffers = typeof record.draftVersion === "number" && record.draftVersion !== live;
  if (!draftDiffers && !dirty) return head;
  return `${head} · ${DRAFT_HAS_EDITS}`;
}

export const MIGRATION_DISABLED = "No safe group to move. Ambiguous runs stay on the version they started on.";

export interface PreviewGroup {
  disposition: "safe" | "ambiguous" | "inactive";
  definitionVersion: number;
  runIds: string[];
  reason: string;
}

/** Groups the migration preview already returned. Safe can move. Ambiguous and finished stay pinned. */
export function previewGroups(preview: unknown): PreviewGroup[] {
  if (!preview || typeof preview !== "object" || !Array.isArray((preview as { cohorts?: unknown }).cohorts)) return [];
  const out: PreviewGroup[] = [];
  for (const cohort of (preview as { cohorts: unknown[] }).cohorts) {
    if (!cohort || typeof cohort !== "object") continue;
    const row = cohort as { disposition?: unknown; definitionVersion?: unknown; runIds?: unknown; reason?: unknown };
    if (row.disposition !== "safe" && row.disposition !== "ambiguous" && row.disposition !== "inactive") continue;
    if (typeof row.definitionVersion !== "number" || !Array.isArray(row.runIds)) continue;
    out.push({
      disposition: row.disposition,
      definitionVersion: row.definitionVersion,
      runIds: row.runIds.filter((id): id is string => typeof id === "string"),
      reason: typeof row.reason === "string" ? row.reason : "",
    });
  }
  return out;
}

export function cohortGroupLabel(currentVersion: number, group: PreviewGroup): string {
  const where = group.definitionVersion === currentVersion ? `version ${group.definitionVersion}, current definition` : `version ${group.definitionVersion}, pinned`;
  if (group.disposition === "safe") return `Safe group, ${where}`;
  if (group.disposition === "ambiguous") return `Ambiguous group, ${where}`;
  return `Finished group, ${where}`;
}

/** Run ids the server marked safe. Anything else stays pinned. */
export function safeRunIds(preview: unknown): string[] {
  if (!preview || typeof preview !== "object" || !Array.isArray((preview as { cohorts?: unknown }).cohorts)) return [];
  const ids: string[] = [];
  for (const cohort of (preview as { cohorts: unknown[] }).cohorts) {
    if (!cohort || typeof cohort !== "object") continue;
    const row = cohort as { disposition?: unknown; runIds?: unknown };
    if (row.disposition !== "safe" || !Array.isArray(row.runIds)) continue;
    for (const id of row.runIds) if (typeof id === "string") ids.push(id);
  }
  return ids;
}
