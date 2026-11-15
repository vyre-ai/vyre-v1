// The Rewind card's words (chat gap G36, G37). Said on the card before anyone presses: what going back puts back, and what it never touches. Pure.
export interface RewindPoint {
  pointId: string;
  agentId: string;
  at: number;
  files: number;
  after?: string | undefined;
  /** The message of yours this point was taken for. */
  messageId?: string | undefined;
  /** The point a rewind took just before it: going back to it undoes the rewind. */
  undo?: boolean | undefined;
  /** The folder was read after the agent had begun: it is the folder during the turn, never before the message. */
  during?: boolean | undefined;
}

/** The one line said before the press: what it does, in the fewest words. */
export const UNDOES =
  "Puts this agent's folder back and removes files made since, by anyone. Nothing already sent, no record and no task changes.";
export const LEAVES = "Messages stay.";
/** Said in a chat with other people. */
export const SHARED =
  "Everyone here sees that you went back, and the agents stop reading everyone's messages after that point. Only your own messages can be gone back to.";
/** Behind "What is not kept": exactly what is left alone, and what the agent forgets. */
export const NOT_KEPT =
  "Left exactly as they are now, neither removed nor put back: files your project's .gitignore lists, node_modules, logs, secret files (credentials, tokens, keys, certificates) and a project that is its own git repository. A secret inside a text file over 256 KB, or in a file that looks binary, under an ordinary name is not recognised, so it can be kept. This agent forgets what it was doing; other agents in this chat do not. A point is saved first, so you can come back. At most 30 points are kept (that one included), and a point older than 14 days is removed within the hour.";
export const NONE =
  "No points yet. A point is saved each time an agent that works in a folder on the Space's computer starts work on one of your messages.";
/** Said once when an agent of this chat works on the person's own computer. */
export const OWN_COMPUTER = "Work done on your own computer cannot be gone back to here.";

/** One line for a point: the time, what they had asked, and how many files it holds. */
export function pointLine(p: RewindPoint, time: (ms: number) => string): { when: string; what: string; files: string } {
  return {
    when: time(p.at),
    what: p.undo
      ? "Before you went back (undo)"
      : `${p.during ? "During: " : ""}${p.after && p.after !== "" ? p.after : "An earlier message"}`,
    files: p.files === 1 ? "1 file" : `${p.files} files`,
  };
}

export function whyOff(_why: string | undefined): string {
  return "Only a chat with an agent goes back.";
}

/** A rewind in force (engine.rewind.points `active`): the messages after `afterSeq` up to `uptoSeq` are folded away. `undoPointId` is there only for the person who went back. */
export interface ActiveRewind {
  afterSeq: number;
  uptoSeq: number;
  by: string;
  at: number;
  undoPointId?: string | undefined;
  /** The rewind did not finish: nothing is folded, Undo puts the folder back. */
  interrupted?: boolean | undefined;
}
