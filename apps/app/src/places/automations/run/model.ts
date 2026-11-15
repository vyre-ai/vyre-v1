// A run as a page of rows (design 2.9), numbered exactly as the builder is (story/model.ts `ordered`). A failure is plain: "Stopped at step 2, Text to me. <why> Add it and run again." with one button.
// A step that was held in a test or by a rule says "Not sent". Pure.
import { ordered, sentence } from "../story/model.ts";
import type { Sentence, StepIn, TriggerIn } from "../story/model.ts";

export interface RunResult {
  status: "ok" | "failed" | "held" | "waiting";
  line?: string;
  values?: readonly (readonly [string, string])[];
  /** Why it failed, in the server's plain words. */
  why?: string;
  /** The one fix, as its button words. */
  fix?: string;
}

export interface RunRow {
  id: string;
  number: number;
  depth: number;
  sentence: Sentence;
  app: { id: string; name: string };
  action: string;
  why?: string;
  mark: "done" | "failed" | "held" | "waiting" | "skipped";
  tag: "Not sent" | null;
  line: string | null;
  values: readonly (readonly [string, string])[];
}

export interface RunBanner {
  title: string;
  text: string;
  button: string;
}

export function runView(
  steps: readonly StepIn[],
  results: Record<string, RunResult | undefined>,
  trigger?: TriggerIn,
): {
  when: { app: { id: string; name: string }; sentence: Sentence } | null;
  rows: RunRow[];
  banner: RunBanner | null;
} {
  const rows: RunRow[] = [];
  let banner: RunBanner | null = null;
  let stopped = false;
  for (const { step, number, depth } of ordered(steps)) {
    const r = results[step.id];
    const base = { id: step.id, number, depth, sentence: sentence(step), app: step.app, action: step.action };
    if (stopped || !r) {
      rows.push({ ...base, mark: "skipped", tag: null, line: null, values: [] });
      continue;
    }
    if (r.status === "failed") {
      stopped = true;
      banner = {
        title: `Stopped at step ${number}, ${step.action}`,
        text: `${r.why ?? ""}${r.why ? " " : ""}Add it and run again.`,
        button: r.fix ?? "Try again",
      };
      rows.push({ ...base, ...(r.why ? { why: r.why } : {}), mark: "failed", tag: null, line: null, values: [] });
      continue;
    }
    if (r.status === "waiting") stopped = true;
    rows.push({
      ...base,
      mark: r.status === "ok" ? "done" : r.status,
      tag: r.status === "held" ? "Not sent" : null,
      line: r.line ?? null,
      values: r.values ?? [],
    });
  }
  return { when: trigger ? { app: trigger.app, sentence: sentence(trigger) } : null, rows, banner };
}
