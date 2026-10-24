// Frozen props for ui/NeedsTeamSpace. Spec 3.10 and 2.1, ARCH 5.13 and 7.6, F9.
// A Personal Space hides teamOnly capabilities behind this one sentence.
// The words do not vary: callers only say what is blocked.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

export const NEEDS_TEAM_SPACE_LABEL = "Needs a Team Space";

export const NEEDS_TEAM_SPACE_ACTION = "Create or join a Team Space";

export interface NeedsTeamSpaceProps {
  /** What is blocked, such as "Sites, forms and campaigns". Empty when the sentence is enough. */
  what: string;
  density: Density;
}

export const frozenNeedsTeamSpaceProps = {
  what: "Sites, forms and campaigns",
  density: "compact",
} as const satisfies NeedsTeamSpaceProps;
