// from vyre 0.6.9 core/switchboard/rollover.js@dbd2dfbab (the pure part: how full a window is, whether to roll now, the pointer index)
// Vyre owns the context window of every session it runs. An agent's own compaction keeps a summary and loses the lines. Vyre rolls over first: between turns, before the window fills,
// it ends the session, starts a fresh one, and the fresh session's first message carries a seed built from the transcript: the summary, an index of pointers into the dropped span, and the
// last turns word for word. The dropped span is still stored, so any line of it is one transcript_get away. The worker does the stopping and starting; this file decides and counts.
import { tokensOfChars } from "./tokens.ts";
import { windowFor } from "./windows.ts";
import type { Pointers, Turn } from "./types.ts";

/** How rollover behaves unless a setting says otherwise. */
export const ROLL = Object.freeze({
  /** Roll at this share of the window, at the first turn boundary where nothing is running. */
  at: 0.8,
  /** Roll at this share whatever is running: a background job is stopped rather than let the window fill. */
  force: 0.9,
  /** Before a message is sent: if the share used plus this message would reach it, roll first. The engine's own compaction stays on as the backstop. */
  guard: 0.92,
  /** How many turn boundaries to wait for a running tool or background job before rolling anyway. */
  wait: 3,
  /** At most one rollover per this many turns: a seed already over the threshold must never roll again at once. */
  gap: 10,
  /** The seed is at most this many characters (about 25,000 tokens). */
  seedChars: 100_000,
  /** Of which the last turns, word for word, take at most this many (about 15,000 tokens). */
  tailChars: 60_000,
  /** One turn in the tail is cut at this many characters, with a pointer to the rest. */
  turnChars: 6_000,
  /** Pointer lines in the seed's index. */
  lines: 30,
  /** What an agent's own prompt and tools hold before the conversation (tokens), for the estimate. */
  baseline: 12_000,
});
export type RollLimits = { -readonly [K in keyof typeof ROLL]?: number };

export interface Context { used: number; window: number; share: number; source: "reported" | "estimated" }

/**
 * How full a session's window is. The engine's own report wins (`used`); with none, the characters said so far (a rough four to a token, plus what the engine itself carries)
 * against the model's window.
 */
export function contextOf(o: { used?: number; window?: number; chars?: number; model?: string | null; provider?: string | null }): Context {
  const win = o.window && o.window > 0 ? o.window : windowFor(o.model ?? null, o.provider ?? null);
  const used = o.used ?? 0;
  if (used > 0) return { used, window: win, share: used / win, source: "reported" };
  const est = tokensOfChars(o.chars ?? 0) + ROLL.baseline;
  return { used: est, window: win, share: est / win, source: "estimated" };
}

export interface RollDecision { roll: boolean; why: string; wait?: boolean }

/**
 * Whether to roll at this turn boundary.
 * `blocked` says why something is running (a tool, a background job, a question, a queued message), or null; `waited` is the boundaries already passed over for that;
 * `sinceRoll` is the turns since the last rollover, null if there has been none.
 */
export function decide(o: { ctx: Pick<Context, "share" | "source">; blocked?: string | null; waited?: number; sinceRoll?: number | null; limits?: RollLimits }): RollDecision {
  const L = { ...ROLL, ...o.limits };
  const blocked = o.blocked ?? null;
  const waited = o.waited ?? 0;
  const sinceRoll = o.sinceRoll ?? null;
  // An estimate errs early on purpose (it is a count of characters, not the window itself): it rolls at 5/6 of the share a report would.
  const scale = o.ctx.source === "estimated" ? 5 / 6 : 1;
  const lo = L.at * scale, hi = L.force * scale;
  if (o.ctx.share < lo) return { roll: false, why: "below the threshold" };
  if (sinceRoll !== null && sinceRoll < L.gap) return { roll: false, why: `rolled ${sinceRoll} turns ago` };
  if (!blocked) return { roll: true, why: o.ctx.share >= hi ? "forced" : "at the threshold" };
  if (o.ctx.share >= hi) return { roll: true, why: `forced (${blocked})` };
  if (waited >= L.wait) return { roll: true, why: `waited ${waited} turns for: ${blocked}` };
  return { roll: false, why: `waiting for: ${blocked}`, wait: true };
}

/** Words a model wrote or a person pasted, quoted into a Vyre block: every line indented so a line of its own that looks like the block's end stays inside. */
export const quote = (text: string): string => String(text).split("\n").map((l) => `  | ${l}`).join("\n");

export const cutTo = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/**
 * The pointer index for a span of turns, without a model: one line per person request (turn number, who, the start of what was asked), then the files and commits touched.
 * When there are more lines than `max`, the newest take most of them and the older ones are thinned evenly, so every stretch of the span keeps a pointer.
 */
export function pointersOf(turns: readonly Turn[], max: number = ROLL.lines): Pointers {
  const asks = turns.filter((t) => t.role === "person");
  const line = (t: Turn): string => {
    const text = t.parts.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join(" ").replace(/\s+/g, " ").trim();
    return `#${t.n} ${t.authorId}: ${cutTo(text, 120)}`;
  };
  const lines = asks.length <= max ? asks.map(line) : (() => {
    const newest = Math.ceil(max * 0.6);
    const older = asks.slice(0, asks.length - newest);
    const room = max - newest;
    const thin = Array.from({ length: room }, (_, k) => older[Math.floor((k * older.length) / room)]).filter((t): t is Turn => t !== undefined);
    return [...thin, ...asks.slice(asks.length - newest)].map(line);
  })();
  const files = new Map<string, number[]>();
  const commits = new Map<string, number>();
  for (const t of turns) {
    for (const l of t.links) {
      if (l.kind === "file" || l.kind === "read") files.set(l.ref, [...(files.get(l.ref) ?? []), t.n].slice(-4));
      else if (l.kind === "commit") commits.set(l.ref, t.n);
    }
  }
  return {
    lines,
    files: [...files].map(([ref, at]) => ({ ref, at })).sort((a, b) => b.at.length - a.at.length || (a.ref < b.ref ? -1 : 1)).slice(0, 12),
    commits: [...commits].map(([ref, at]) => ({ ref, at })).slice(-8),
    turns: turns.length,
  };
}
