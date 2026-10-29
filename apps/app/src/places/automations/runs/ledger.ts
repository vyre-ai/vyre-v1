// Durable step rows projected onto the canvas, and which runs can still be stopped.
import type { RunState } from "../canvas/model.ts";

export interface StepRowLite {
  step: string;
  state: string;
  attempt?: number;
  branch?: string;
  error?: { code?: string; message?: string };
}

const STATE: Readonly<Record<string, RunState>> = {
  pending: "pending",
  running: "running",
  succeeded: "done",
  failed: "failed",
  skipped: "skipped",
  waiting: "waiting",
  stopped: "failed",
};

export function statesFromSteps(steps: readonly StepRowLite[]): Record<string, RunState> {
  const out: Record<string, RunState> = {};
  for (const step of steps) {
    if (!step.step) continue;
    out[step.step] = STATE[step.state] ?? "pending";
  }
  return out;
}

/** Stop is for work that is still going. A failed or succeeded run has already finished. */
export function canStopRun(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting";
}

export function stepsFromCall(out: unknown): StepRowLite[] | null {
  if (!out || typeof out !== "object" || !Array.isArray((out as { steps?: unknown }).steps)) return null;
  const steps: StepRowLite[] = [];
  for (const row of (out as { steps: unknown[] }).steps) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec["step"] !== "string" || typeof rec["state"] !== "string") continue;
    const error = rec["error"] && typeof rec["error"] === "object" ? rec["error"] as { code?: string; message?: string } : undefined;
    steps.push({
      step: rec["step"],
      state: rec["state"],
      ...(typeof rec["attempt"] === "number" ? { attempt: rec["attempt"] } : {}),
      ...(typeof rec["branch"] === "string" && rec["branch"].length > 0 ? { branch: rec["branch"] } : {}),
      ...(error ? { error: { ...(typeof error.code === "string" ? { code: error.code } : {}), ...(typeof error.message === "string" ? { message: error.message } : {}) } } : {}),
    });
  }
  return steps;
}

export const SANDBOX_REPLAY_LABEL = "Replay in sandbox";
export const LIVE_RERUN_LABEL = "Re-run live";

/** Names the outward effects a live rerun can repeat. This is not a sandbox replay. */
export function liveRerunWarning(effects: readonly string[]): string {
  const named = effects.length > 0 ? effects.join(", ") : "sending messages and writing records";
  return `Re-run live will run this Automation again. It can repeat outward effects: ${named}. Confirm to continue.`;
}

const OUTWARD: Readonly<Record<string, string>> = {
  send_email: "sending email",
  send_sms: "sending a text message",
  post_message: "posting a chat message",
};

export function outwardEffects(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const label = OUTWARD[key];
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
