// The round row (chat gap G56, DESIGN-multi-tag-and-assistant Part 3 C): under a message that asked more than one agent, each agent and its state, so nothing looks ignored. Pure: engine.round.get
// supplies the states; the words come from here. One line per agent, "Dex  Working", "Nova  Waiting on Dex"; the row folds away when every agent has replied.
import { ALL_AGENTS } from "../../../../../../lib/route.ts";

export type RoundState = "working" | "waiting" | "replied" | "stopped";
export interface RoundAgent {
  agentId: string;
  state: RoundState;
  on?: string;
}

/** How long after a send the row looks for its round: a round older than this is history and is not read again. */
export const ROUND_WINDOW_MS = 120_000;

/** Does this message start a round worth watching: two or more tagged agents, or words that speak to all of them. A one-agent ask has its own working line. */
export function asksSeveral(m: {
  body: string;
  mentions?: readonly { kind: string; id: string }[] | undefined;
}): boolean {
  const tagged = new Set((m.mentions ?? []).filter((x) => x.kind === "agent").map((x) => x.id));
  return tagged.size > 1 || ALL_AGENTS.test(m.body);
}

/** The agents to show, or none: a round of one agent is not a round, and a round whose agents have all replied folds away. */
export function visibleRound(agents: readonly RoundAgent[]): RoundAgent[] {
  if (agents.length < 2) return [];
  if (agents.every((a) => a.state === "replied")) return [];
  return [...agents];
}

export function stateWords(a: RoundAgent, nameOf: (id: string) => string): string {
  switch (a.state) {
    case "working":
      return "Working";
    case "waiting":
      return a.on ? `Next after ${nameOf(a.on)}` : "Next";
    case "replied":
      return "Replied";
    case "stopped":
      return "Stopped";
  }
}

/** Should the row keep reading: the message is recent and either no round has been seen yet or someone has not finished. */
export function keepReading(age: number, agents: readonly RoundAgent[]): boolean {
  if (age > ROUND_WINDOW_MS) return false;
  return agents.length === 0 || agents.some((a) => a.state === "working" || a.state === "waiting");
}
