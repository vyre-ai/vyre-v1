// What the Assistant is told about the onboarding screen, in the shape Ask Vyre uses for any place (place, title, open, selection, rows, actions, focus): ids only, never content. When the
// Ask door lands in the shell (chat-brain, ask/screen.ts) the host calls setScreenContext(onboardingScreen(...)) with this; until then it is built and tested here and nothing reads it.
import { counts, stepsOf, stateOf } from "./flow.ts";
import type { FlowKind, Progress } from "./flow.ts";

export interface OnboardingScreenContext {
  place: "onboarding";
  title: string;
  open: { type: "onboarding_step"; id: string; title: string }[];
  rows: { shown: number; total: number; sample: string[] };
  actions: string[];
  focus: "focus-onboarding" | "focus-onboarding-team" | "focus-onboarding-member";
}

export function onboardingScreen(flow: FlowKind, step: string | null, progress: Progress): OnboardingScreenContext {
  const steps = stepsOf(flow);
  const at = steps.find((s) => s.key === step);
  const c = counts(flow, progress);
  return {
    place: "onboarding",
    title: flow === "personal" ? "Set up your Personal Space" : flow === "team" ? "Set up your Team Space" : "Welcome to the Space",
    open: at ? [{ type: "onboarding_step", id: at.key, title: at.title }] : [],
    rows: { shown: steps.length, total: steps.length, sample: steps.map((s) => `${s.key}: ${stateOf(progress, s.key)}`) },
    actions: ["spaces.onboarding.mark", "spaces.onboarding.flow", "memory.propose_fact", ...(c.done === c.total ? [] : ["spaces.onboarding.seen"])],
    focus: flow === "personal" ? "focus-onboarding" : flow === "team" ? "focus-onboarding-team" : "focus-onboarding-member",
  };
}
