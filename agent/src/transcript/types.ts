// The provider-neutral transcript (ARCH 6.9). Every turn of every engine writes the same rows: an API driver directly, a CLI through its stream or its session file.
// A row never holds a credential (sanitize.ts runs first), a whole tool input, or a tool output past the cap.

export interface Link { kind: "file" | "read" | "commit" | "url"; ref: string }

export type Part =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  /** `summary` is what a person reads ("Edit src/OrderForm.js"); `args` only the fields worth finding again (path, command, query), already redacted and cut. */
  | { kind: "tool_call"; id: string; name: string; tool: string; summary: string; args: { path?: string; command?: string; query?: string }; links: Link[] }
  | { kind: "tool_result"; id: string; ok: boolean; output: string; cut: boolean }
  /** A native block the turn produced (ARCH 6.8), kept by type so the transcript can say what was shown. */
  | { kind: "block"; type: string; data: unknown };

export interface Tokens { in: number; out: number }

export interface EngineRef { driver: string; provider: string; model: string; effort?: string }

/** One conversation turn: a person's message, or everything an agent did in answer to it. */
export interface Turn {
  threadId: string;
  /** Per thread, from 1, in the order the turns were stored. */
  n: number;
  role: "person" | "agent";
  authorId: string;
  /** The engine that produced an agent turn ('claude_code', 'anthropic' ...), null for a person. */
  engine: string | null;
  model: string | null;
  at: number;
  parts: Part[];
  /** What the turn touched or named: files, commits, urls. A lookup key per link, not a search. */
  links: Link[];
  tokens: Tokens;
  error?: { code: string; message: string };
}
export type NewTurn = Omit<Turn, "n">;

/** The rolling summary of a thread: everything up to and including turn `upTo`, kept by a cheap background turn. */
export interface Summary { threadId: string; text: string; upTo: number; by: string; at: number }

/** The quiet line "Switched to Codex ..." and what it carried, kept so a model that returns later gets what was said while it was away. */
export interface SwitchRow {
  threadId: string;
  agentId: string;
  at: number;
  /** The last turn number before the switch. */
  atTurn: number;
  from: EngineRef;
  to: EngineRef;
  handoffTurns: number;
  by: string;
}

export interface Pointers {
  /** `#12 person: the start of what was asked`, one per kept turn. */
  lines: string[];
  files: Array<{ ref: string; at: number[] }>;
  commits: Array<{ ref: string; at: number }>;
  turns: number;
}
