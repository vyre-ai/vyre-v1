// ui/Status states: the ten states a row's work can be in, with their words, tone and outline. Pure data (no drawing), so a model or a menu can say a state's words without loading a component.
// The drawing is StateMark.tsx beside this file; read its head for the design.
export type WorkState =
  | "review"
  | "allow"
  | "answer"
  | "sign"
  | "blocked"
  | "overdue"
  | "failed"
  | "waiting"
  | "done"
  | "running";
export type MarkTone = "yours" | "warn" | "bad" | "quiet" | "live";

interface Shape {
  /** What the tip and a screen reader say. */
  words: string;
  /** The one word of the row's action or of the state, for a menu, a button and the fallback off the web. */
  short: string;
  tone: MarkTone;
  /** Stroked paths on a 16 by 16 box. */
  d: readonly string[];
  /** Filled paths (the eye's pupil). */
  fill?: readonly string[];
}

export const STATE_MARKS: Readonly<Record<WorkState, Shape>> = {
  review: {
    words: "Needs your review",
    short: "Review",
    tone: "yours",
    d: ["M1.7 8S4 3.8 8 3.8 14.3 8 14.3 8 12 12.2 8 12.2 1.7 8 1.7 8z"],
    fill: ["M8 6.100a1.900 1.900 0 110 3.800 1.900 1.900 0 010-3.800z"],
  },
  allow: {
    words: "Needs your approval",
    short: "Allow",
    tone: "yours",
    d: [
      "M8 1.9l5 1.9v3.700c0 3.100-2.100 5.400-5 6.600-2.900-1.200-5-3.500-5-6.600V3.800z",
      "M5.700 7.900l1.700 1.700 3-3.300",
    ],
  },
  answer: {
    words: "Waiting for your answer",
    short: "Answer",
    tone: "yours",
    d: [
      "M3.500 2.800h9a1.500 1.500 0 011.500 1.500v5.400a1.500 1.500 0 01-1.500 1.500H8l-3.200 2.500v-2.500H3.500A1.500 1.500 0 012 9.700V4.300a1.500 1.500 0 011.500-1.500z",
      "M6.700 5.900a1.350 1.350 0 112 1.150c-.45.27-.7.5-.7.95",
      "M8 9.550v.01",
    ],
  },
  sign: {
    words: "Needs your signature",
    short: "Sign",
    tone: "yours",
    d: [
      "M2.200 10.600C3.700 9.500 5.900 6.300 5.900 4.200c0-1.200-1-1.500-1.600-.5-.9 1.500-.6 5.100.5 6.500.6.800 1.300.3 1.900-.7.5-.8 1.100-.9 1.300-.1.200.8.700 1.200 1.400.7.600-.5 1.100-.6 1.500-.1.400.5 1.200.600 2.900.200",
      "M2.200 13.400h11.600",
    ],
  },
  blocked: {
    words: "Blocked",
    short: "Blocked",
    tone: "warn",
    d: ["M5.700 2.400h4.600l3.300 3.300v4.600l-3.300 3.300H5.700l-3.300-3.300V5.700z", "M5.600 8h4.800"],
  },
  overdue: {
    words: "Overdue",
    short: "Overdue",
    tone: "warn",
    d: ["M8 2.200a5.800 5.800 0 110 11.600 5.800 5.800 0 010-11.600z", "M8 4.700V8l2.300 1.500"],
  },
  failed: {
    words: "Failed",
    short: "Failed",
    tone: "bad",
    d: ["M8 2.500l6 10.500H2z", "M8 6.600v3", "M8 11.300v.01"],
  },
  waiting: {
    words: "Waiting on someone",
    short: "Waiting",
    tone: "quiet",
    d: [
      "M4.400 2.400h7.200M4.400 13.600h7.200",
      "M5.300 2.400v2c0 1.500 2.700 2.300 2.700 3.600s-2.700 2.100-2.700 3.600v2M10.700 2.400v2c0 1.500-2.700 2.300-2.700 3.600s2.700 2.100 2.700 3.600v2",
    ],
  },
  done: { words: "Done", short: "Done", tone: "quiet", d: ["M3.300 8.600l3 3 6.400-7"] },
  running: { words: "Running", short: "Running", tone: "live", d: ["M8 2.200A5.800 5.800 0 1013.800 8"] },
};
export const WORK_STATES = Object.keys(STATE_MARKS) as WorkState[];

export const MARK_COLOR: Readonly<Record<MarkTone, string>> = {
  yours: "var(--accent)",
  warn: "var(--warn)",
  bad: "var(--danger)",
  quiet: "var(--ink-3)",
  live: "var(--beacon)",
};

/** What a state says in words: "Needs your review", and with a note "Needs your review: Ember changed 3 files". */
export function stateWords(state: WorkState, note?: string): string {
  const w = STATE_MARKS[state].words;
  return note ? `${w}: ${note}` : w;
}
