// The first page's rows from the one list of Automations the sidebar already reads (automations.list): which need him, what ran today, and the count line. Until a server read says why in words (b-skill's
// Needs-you read), the reason is the plain fact the list carries: it is paused, or its last run failed.
import type { AutoRow } from "../sidebar/model.ts";
import { needsYou } from "../sidebar/model.ts";
import type { NeedIn, TodayIn } from "./model.ts";

export function needsFromAutomations(rows: readonly AutoRow[]): NeedIn[] {
  return rows.filter(needsYou).map((a) => {
    const failed = a.lastRun?.status === "failed" || a.failedRuns > 0;
    const runId = failed ? a.lastRun?.runId : undefined;
    return {
      id: a.id,
      automation: a.name,
      why:
        a.status === "paused"
          ? "It is paused."
          : a.failedRuns > 1
            ? `${a.failedRuns} runs failed.`
            : "Its last run failed.",
      at: a.lastRun?.at ?? a.updatedAt,
      ...(runId ? { runId } : {}),
      fix: { label: "Open it", kind: "see" as const },
    };
  });
}

const DAY = 86_400_000;
export function todayFromAutomations(rows: readonly AutoRow[], now: number): TodayIn {
  const start = now - (now % DAY);
  const today = rows.flatMap((a) => (a.lastRun && a.lastRun.at >= start ? [a.lastRun] : []));
  return { ran: today.length, failed: today.filter((r) => r.status === "failed").map((r) => ({ runId: r.runId })) };
}

export function summaryLine(rows: readonly AutoRow[]): string {
  if (rows.length === 0) return "";
  const on = rows.filter((a) => a.status === "on").length;
  const need = rows.filter(needsYou).length;
  const head = on === 0 ? "None on" : `${on} on`;
  return need > 0 ? `${head}, ${need} ${need === 1 ? "needs" : "need"} you` : head;
}
