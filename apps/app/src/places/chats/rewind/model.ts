// The Rewind card's words (chat gap G36, G37). Said on the card before anyone presses: what going back puts back, and what it never touches. Pure.
export interface RewindPoint {
  pointId: string;
  agentId: string;
  at: number;
  files: number;
  after?: string | undefined;
}

export const UNDOES = "Puts the agent's files back as they were, and the agents stop reading what came after.";
export const LEAVES =
  "Messages stay. Anything already sent stays sent: email, messages, posts, records and tasks. Other computers are not touched.";
export const UNDO_NOTE = "A point of now is saved first, so you can come back.";
export const OFF_GROUP = "Going back is off in a chat with other people.";
export const NONE = "No points yet. One is saved each time an agent starts work in its folder.";

/** One line for a point: the time, what they had asked, and how many files it holds. */
export function pointLine(p: RewindPoint, time: (ms: number) => string): { when: string; what: string; files: string } {
  return {
    when: time(p.at),
    what: p.after && p.after !== "" ? p.after : "An earlier turn",
    files: p.files === 1 ? "1 file" : `${p.files} files`,
  };
}

export function whyOff(why: string | undefined): string {
  return why === "group" ? OFF_GROUP : "Only a chat with an agent goes back.";
}
