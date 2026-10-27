// A schedule backlog over its cap is one Needs You task. These choices are the ones the server accepts.
export type ScheduleChoiceKey = "run_first_n" | "run_latest_n" | "skip_backlog_and_resume" | "change_limits" | "keep_paused";

export interface ScheduleChoice {
  key: ScheduleChoiceKey;
  label: string;
}

export interface ScheduleRequest {
  automationId: string;
  choices: ScheduleChoice[];
}

const PREFIX = "automation-schedule:";
const KEYS = new Set<string>(["run_first_n", "run_latest_n", "skip_backlog_and_resume", "change_limits", "keep_paused"]);

export const SCHEDULE_CHOICES: readonly ScheduleChoice[] = [
  { key: "run_first_n", label: "Run first N" },
  { key: "run_latest_n", label: "Run latest N" },
  { key: "skip_backlog_and_resume", label: "Skip backlog and resume" },
  { key: "change_limits", label: "Change limits" },
  { key: "keep_paused", label: "Keep paused" },
];

export function scheduleRequestFromTask(task: unknown): ScheduleRequest | null {
  if (!task || typeof task !== "object") return null;
  const source = (task as { source?: { id?: unknown } }).source;
  const id = source && typeof source.id === "string" ? source.id : "";
  if (!id.startsWith(PREFIX) || id.length === PREFIX.length) return null;
  const found: ScheduleChoice[] = [];
  const blocks = (task as { blocks?: unknown }).blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const data = block && typeof block === "object" ? (block as { data?: { choices?: unknown } }).data : undefined;
      const listed = data && Array.isArray(data.choices) ? data.choices : [];
      for (const choice of listed) {
        if (!choice || typeof choice !== "object") continue;
        const key = (choice as { key?: unknown }).key;
        const label = (choice as { label?: unknown }).label;
        if (typeof key !== "string" || !KEYS.has(key) || typeof label !== "string" || label.length === 0) continue;
        found.push({ key: key as ScheduleChoiceKey, label });
      }
    }
  }
  return { automationId: id.slice(PREFIX.length), choices: found.length > 0 ? found : [...SCHEDULE_CHOICES] };
}

export function choiceStartsRuns(key: string): boolean {
  return key === "run_first_n" || key === "run_latest_n";
}

export function readChoiceResult(out: unknown): { ok: boolean; started: number; paused: boolean; error?: string } | null {
  if (!out || typeof out !== "object") return null;
  const row = out as { ok?: unknown; started?: unknown; paused?: unknown; error?: unknown };
  if (typeof row.ok !== "boolean" || typeof row.paused !== "boolean" || !Array.isArray(row.started)) return null;
  const result: { ok: boolean; started: number; paused: boolean; error?: string } = { ok: row.ok, started: row.started.length, paused: row.paused };
  if (typeof row.error === "string" && row.error.length > 0) result.error = row.error;
  return result;
}
