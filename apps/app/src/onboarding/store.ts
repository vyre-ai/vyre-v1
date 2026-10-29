// Where the onboarding screen keeps its place: spaces.onboarding.flow / .mark / .seen on the Space the person is in, so it resumes on any device and from the Home checklist.
import type { CapCall } from "../shell/session/caps.ts";
import type { FlowKind, Progress, StepState } from "./flow.ts";

export interface FlowState { seen: boolean; progress: Progress }

export async function loadFlow(call: CapCall, flow: FlowKind): Promise<FlowState> {
  const out = await call("spaces.onboarding.flow", { flow }) as { seen: boolean; steps: { key: string; state: "done" | "later" }[] };
  return { seen: out.seen, progress: Object.fromEntries(out.steps.map((s) => [s.key, s.state])) };
}

export async function markStep(call: CapCall, flow: FlowKind, step: string, state: StepState): Promise<void> {
  await call("spaces.onboarding.mark", { flow, step, state });
}

export async function markSeen(call: CapCall, flow: FlowKind): Promise<void> {
  await call("spaces.onboarding.seen", { flow });
}

/** A person who already used the first-run checklist (finished a step or hid it) has been here before: the screen must not open over their work. */
export async function usedChecklistBefore(call: CapCall): Promise<boolean> {
  const out = await call("spaces.onboarding.get", {}) as { dismissed: boolean; steps: { done: boolean }[] };
  return out.dismissed || out.steps.some((s) => s.done);
}

/** Which flow this person walks here. A Personal Space is always its owner's; in a Team Space the role name from the Space tile says whether they own it. */
export async function flowOfSession(call: CapCall, kind: "personal" | "team"): Promise<FlowKind> {
  if (kind === "personal") return "personal";
  const tile = await call("spaces.switcher", {}) as { role?: string };
  return (tile.role ?? "").toLowerCase() === "owner" ? "team" : "member";
}

/** Anything on screen (the Home checklist, the Console) asks the host to open the onboarding screen, optionally at one step. */
type Opener = (step?: string) => void;
let opener: Opener | null = null;
export function registerOnboardingOpener(open: Opener | null): () => void { opener = open; return () => { if (opener === open) opener = null; }; }
export function openOnboarding(step?: string): boolean { if (!opener) return false; opener(step); return true; }
