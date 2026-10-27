// The recovery choice a person makes from Needs You. The clock still uses the same function through the host call.
import { chooseScheduleRecovery } from "../schedule/live.ts";
import type { ChoiceLimits, ScheduleChoiceKey } from "../schedule/schedule.ts";
import type { AutoCtx } from "../projections.ts";
import { raise } from "../projections.ts";

const CHOICES = new Set<ScheduleChoiceKey>(["run_first_n", "run_latest_n", "skip_backlog_and_resume", "change_limits", "keep_paused"]);

type In = {
  automationId?: unknown;
  choice?: unknown;
  n?: unknown;
  limits?: unknown;
};

function limitsOf(value: unknown): ChoiceLimits | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const out: ChoiceLimits = {};
  if (typeof row["lookbackMs"] === "number") out.lookbackMs = row["lookbackMs"];
  if (typeof row["cap"] === "number") out.cap = row["cap"];
  if (typeof row["spacingMs"] === "number") out.spacingMs = row["spacingMs"];
  if (row["overlap"] === "queue" || row["overlap"] === "skip_while_active" || row["overlap"] === "bounded_concurrency") out.overlap = row["overlap"];
  if (typeof row["concurrency"] === "number") out.concurrency = row["concurrency"];
  return out;
}

export async function scheduleChoose(ctx: AutoCtx, input: In): Promise<unknown> {
  const automationId = typeof input.automationId === "string" ? input.automationId : "";
  const choice = input.choice;
  if (!automationId || typeof choice !== "string" || !CHOICES.has(choice as ScheduleChoiceKey)) {
    raise(ctx, "validation.bad_input", "Name the automation and one recovery choice.");
  }
  const result = await chooseScheduleRecovery(ctx, {
    automationId,
    choice: choice as ScheduleChoiceKey,
    ...(typeof input.n === "number" ? { n: input.n } : {}),
    ...(input.limits !== undefined ? { limits: limitsOf(input.limits) } : {}),
  });
  if (!result.ok) return { ok: false, started: [], paused: true, error: result.error };
  return { ok: true, started: result.started, paused: result.paused };
}
