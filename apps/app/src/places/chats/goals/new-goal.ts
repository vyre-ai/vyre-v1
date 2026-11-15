// New goal (the pure part): what the sheet asks for and the goals.create input it becomes. A person names the outcome, picks the agent that leads it and a deadline; the finish line is the person's own call
// (kind "owner"), which they can change on the goal's page. The goal opens at once, as a draft the person starts.
import type { CapMap } from "../../../../../../generated/types.ts";

export type GoalCreateIn = CapMap["goals.create"]["in"];
export interface GoalForm {
  title: string;
  /** What done looks like, in words; the title when empty. */
  outcome: string;
  leadAgentId: string;
  /** Days from now. */
  days: number;
}
export const DEADLINES: readonly { days: number; label: string }[] = [
  { days: 1, label: "Tomorrow" },
  { days: 7, label: "In a week" },
  { days: 14, label: "In two weeks" },
  { days: 30, label: "In a month" },
];
export const DAY_MS = 86_400_000;
export const MAX_TITLE = 140;

export function canCreateGoal(f: GoalForm): boolean {
  return f.title.trim() !== "" && f.leadAgentId !== "";
}

/** The agent that leads when the person does not choose: the Space's assistant, else the first agent. */
export function defaultLead(agents: readonly { agentId: string }[], assistantId: string): string {
  return agents.find((a) => a.agentId === assistantId)?.agentId ?? agents[0]?.agentId ?? "";
}

export function goalInput(f: GoalForm, now: number): GoalCreateIn {
  const title = f.title.trim().slice(0, MAX_TITLE);
  return {
    title,
    finish: { kind: "owner", line: f.outcome.trim() || title },
    deadline: now + f.days * DAY_MS,
    leadAgentId: f.leadAgentId,
  };
}

/** What a refused create says on the sheet, in plain words. */
export function goalError(e: unknown): string {
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "";
  if (code.startsWith("permission")) return "You cannot make goals here.";
  if (code === "validation.not_found") return "That agent is not here any more. Pick another.";
  return "The goal was not made. Try again.";
}
