// The chat's one budget of agent turns (owner ruling, 3 Nov 2026): 8 agent turns since a person last wrote, helpers and teammates counted (lib/route.ts). When the newest message is an
// agent's at the limit and nothing is working, the chat is parked: the card says so and Continue writes for the person, which starts the count again. @Name in a reply wakes that agent.
import { DEFAULT_AGENT_HOPS } from "../../../../../../lib/route.ts";

export { DEFAULT_AGENT_HOPS };

export interface HopMessage { author: { kind: string }; depth?: number }

/** Is the chat waiting on a person because the agents used their turns? */
export function parkedAtLimit(last: HopMessage | undefined, limit: number, working: boolean): boolean {
  return !working && last !== undefined && last.author.kind === "agent" && (last.depth ?? 0) >= limit;
}

/** The card's one line. */
export function parkedLine(limit: number): string {
  return `The agents have taken ${limit} turns since a person wrote. Continue, or @mention one agent.`;
}

/** The words Continue posts as the person. */
export const CONTINUE_TEXT = "Continue";

/** The Policies setting as the server answers it, else the default. */
export function limitOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_AGENT_HOPS;
}
