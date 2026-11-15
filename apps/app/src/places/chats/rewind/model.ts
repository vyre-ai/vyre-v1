// The Rewind card's words (chat gap G36, G37). Said on the card before anyone presses: what going back puts back, and what it never touches. Pure.
export interface RewindPoint {
  pointId: string;
  agentId: string;
  at: number;
  files: number;
  after?: string | undefined;
  /** The point a rewind took just before it: going back to it undoes the rewind. */
  undo?: boolean | undefined;
}

export const UNDOES = "Puts the agent's files back as they were, and the agents stop reading what came after.";
export const LEAVES =
  "Messages stay. Anything already sent stays sent: email, messages, posts, records and tasks. Other computers are not touched.";
export const UNDO_NOTE = "A point of now is saved first, so you can come back.";
export const OFF_GROUP = "Going back is off in a chat with other people.";
export const NONE =
  "No points yet. A point is saved each time an agent that works in a folder on the Space's computer starts a turn. An agent with no folder, such as one on an API key, has none.";
/** What a point does not hold, so does not put back. Said on the card before the press. */
export const NOT_KEPT =
  "Not kept, so not put back: files your project's .gitignore lists, node_modules, logs, secret files (.env, keys, certificates), and a project that is its own git repository inside the folder.";
/** How long points last. */
export const KEPT_FOR = "The last 30 points are kept, for 14 days. An older point is gone.";

/** One line for a point: the time, what they had asked, and how many files it holds. */
export function pointLine(p: RewindPoint, time: (ms: number) => string): { when: string; what: string; files: string } {
  return {
    when: time(p.at),
    what: p.undo ? "Before you went back (undo)" : p.after && p.after !== "" ? p.after : "An earlier turn",
    files: p.files === 1 ? "1 file" : `${p.files} files`,
  };
}

export function whyOff(why: string | undefined): string {
  return why === "group" ? OFF_GROUP : "Only a chat with an agent goes back.";
}
