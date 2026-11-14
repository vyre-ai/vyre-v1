// Where the onboarding screen keeps its place: spaces.onboarding.flow / .mark / .seen on the Space the person is in, so it resumes on any device and from the Home checklist.
import type { CapCall } from "../shell/session/caps.ts";
import type { FlowKind, Progress, StepState } from "./flow.ts";

export interface FlowState {
  seen: boolean;
  progress: Progress;
}

export async function loadFlow(call: CapCall, flow: FlowKind): Promise<FlowState> {
  const out = (await call("spaces.onboarding.flow", { flow })) as {
    seen: boolean;
    steps: { key: string; state: "done" | "later" }[];
  };
  return { seen: out.seen, progress: Object.fromEntries(out.steps.map((s) => [s.key, s.state])) };
}

export async function markStep(call: CapCall, flow: FlowKind, step: string, state: StepState): Promise<void> {
  await call("spaces.onboarding.mark", { flow, step, state });
}

export async function markSeen(call: CapCall, flow: FlowKind): Promise<void> {
  await call("spaces.onboarding.seen", { flow });
}

/** The layout key (state.layout.*) that keeps which flows' "Finish setup" entry this person hid: `{ "<flow>": true }`. It is the person's own, on every device. */
export const SETUP_HIDDEN_KEY = "onboarding.setup_hidden";

/** The flows this person hid. A read that fails says none are hidden: the entry shows, which is the safe side. */
export async function loadHidden(call: CapCall): Promise<Readonly<Record<string, true>>> {
  try {
    const out = (await call("state.layout.get", { keys: [SETUP_HIDDEN_KEY] })) as {
      values?: { key: string; value: unknown }[];
    };
    const v = out.values?.find((x) => x.key === SETUP_HIDDEN_KEY)?.value;
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, on]) => on === true)
            .map(([k]) => [k, true as const]),
        )
      : {};
  } catch {
    return {};
  }
}

export async function hideSetup(call: CapCall, flow: FlowKind, current: Readonly<Record<string, true>>): Promise<void> {
  await call("state.layout.set", { key: SETUP_HIDDEN_KEY, value: { ...current, [flow]: true } });
}

/** Earlier versions kept the hidden flag in one browser-wide key, which the next person on that browser inherited and a second device never saw. It cannot be attributed, so it is deleted, never moved. */
export function retireOldHiddenKeys(): void {
  try {
    const st = (globalThis as { localStorage?: Storage }).localStorage;
    if (!st) return;
    const old: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k !== null && k.startsWith("vyre.setup.hidden")) old.push(k);
    }
    for (const k of old) st.removeItem(k);
  } catch {
    /* blocked storage */
  }
}

/** A person who already used the first-run checklist (finished a step or hid it) has been here before: the screen must not open over their work. */
export async function usedChecklistBefore(call: CapCall): Promise<boolean> {
  const out = (await call("spaces.onboarding.get", {})) as { dismissed: boolean; steps: { done: boolean }[] };
  return out.dismissed || out.steps.some((s) => s.done);
}

/** Which flow this person walks here. A Personal Space is always its owner's; in a Team Space the role name from the Space tile says whether they own it. */
export async function flowOfSession(call: CapCall, kind: "personal" | "team"): Promise<FlowKind> {
  if (kind === "personal") return "personal";
  const tile = (await call("spaces.switcher", {})) as { role?: string };
  return (tile.role ?? "").toLowerCase() === "owner" ? "team" : "member";
}

/** Anything on screen (the Home checklist, the Console) asks the host to open the onboarding screen, optionally at one step. */
type Opener = (step?: string) => void;
let opener: Opener | null = null;
export function registerOnboardingOpener(open: Opener | null): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
}
export function openOnboarding(step?: string): boolean {
  if (!opener) return false;
  opener(step);
  return true;
}

/** What the host knows, for anything else on screen that shows the steps (the Home checklist, the Console): the flow and each step's state. Null until the first read. */
export interface PublishedProgress {
  flow: FlowKind;
  progress: Progress;
}
let published: PublishedProgress | null = null;
const watchers = new Set<() => void>();
export function publishProgress(p: PublishedProgress | null): void {
  published = p;
  for (const w of watchers) w();
}
export const readProgress = (): PublishedProgress | null => published;
export function watchProgress(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}
