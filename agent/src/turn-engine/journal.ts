// The journal of a turn's tool calls (r42-runtime): what a turn did, written as it did it, so a server that stopped under a turn that had already called tools can resume it instead of ending it host_lost.
// A call is written when it starts and again when it ends. On recovery the journal says which calls finished (their short result goes into the resumed turn's note), which were in flight, and whether it is safe to
// go on: a read or a call that carries an idempotency key can be asked again with the same key and the server answers once; anything else that was in flight may have changed the world, so the turn is NOT resumed
// (it ends host_lost as before, and a person decides).
export type Safety = "read" | "keyed" | "unsafe";

export interface JournalEntry {
  threadId: string;
  turnId: string;
  callId: string;
  name: string;
  input: unknown;
  /** the name the call went to the server under (its idempotency key is made from it); asked again after a restart it goes under the same one */
  callKey?: string;
  safety: Safety;
  /** started: no answer was seen. done and failed: it answered. held: it waits for a person's yes (the turn parks, it is not lost). */
  state: "started" | "done" | "failed" | "held";
  /** at most JOURNAL_SUMMARY characters of what it answered, or the error code */
  summary?: string;
  /** the call came from an engine that runs its own tools (a block, not a call this engine ran): it can never be asked again */
  own?: boolean;
  at: number;
  endedAt?: number;
}
export const JOURNAL_SUMMARY = 240;
export const MAX_NOTE_ENTRIES = 24;

export interface JournalStore {
  put(e: JournalEntry): void;
  list(turnId: string): JournalEntry[];
  drop(turnId: string): void;
}

export function createMemoryJournal(): JournalStore {
  const by = new Map<string, Map<string, JournalEntry>>();
  return {
    put(e) {
      const m = by.get(e.turnId) ?? by.set(e.turnId, new Map()).get(e.turnId)!;
      m.set(e.callId, { ...e });
    },
    list: (turnId) => [...(by.get(turnId)?.values() ?? [])].sort((a, b) => a.at - b.at).map((e) => ({ ...e })),
    drop: (turnId) => void by.delete(turnId),
  };
}

export interface ResumePlan {
  resumable: boolean;
  /** why not, in a word a log can carry */
  why?: "no_record" | "own_tool" | "unsafe_in_flight" | "held";
  /** the call that stopped it, when that is why */
  tool?: string;
  done: JournalEntry[];
  /** in flight, and safe to ask again with the same key */
  replay: JournalEntry[];
}

export function planResume(entries: readonly JournalEntry[]): ResumePlan {
  if (entries.length === 0) return { resumable: false, why: "no_record", done: [], replay: [] };
  const done = entries.filter((e) => e.state === "done" || e.state === "failed");
  const flight = entries.filter((e) => e.state === "started");
  const own = entries.find((e) => e.own === true);
  if (own) return { resumable: false, why: "own_tool", tool: own.name, done, replay: [] };
  if (entries.some((e) => e.state === "held")) return { resumable: false, why: "held", done, replay: [] };
  const bad = flight.find((e) => e.safety === "unsafe");
  if (bad) return { resumable: false, why: "unsafe_in_flight", tool: bad.name, done, replay: [] };
  return { resumable: true, done, replay: flight };
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
export const summaryOf = (content: unknown): string => {
  let s: string;
  try {
    s = typeof content === "string" ? content : (JSON.stringify(content) ?? "");
  } catch {
    s = "";
  }
  return clip(s, JOURNAL_SUMMARY);
};

/** What the resumed turn is told, in plain words: the server stopped, what was done and what each answered, so nothing finished is done again. */
export function resumeNote(
  done: readonly JournalEntry[],
  replayed: ReadonlyArray<{ entry: JournalEntry; ok: boolean; summary: string }>,
): string {
  const lines = [
    "The server stopped while you were working on this and has started again. You are continuing the same request. Do not repeat what is already done.",
  ];
  const shown = [...done].slice(-MAX_NOTE_ENTRIES);
  if (done.length > shown.length) lines.push(`(${done.length - shown.length} earlier steps are not listed.)`);
  for (const e of shown)
    lines.push(`Done: ${e.name} ${e.state === "failed" ? "failed" : "answered"}: ${e.summary ?? ""}`.trim());
  for (const r of replayed)
    lines.push(
      `${r.entry.name} was running when it stopped; it was asked again and ${r.ok ? "answered" : "failed"}: ${r.summary}`.trim(),
    );
  lines.push("Carry on from here.");
  return lines.join("\n");
}
