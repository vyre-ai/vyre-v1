// Compaction (ARCH 6.9): long chats shrink to summary + retrieval. A background turn on a cheap model keeps the rolling summary; when there is no such model, or it fails,
// a plain extract of the asks and outcomes stands in, so a switch or a rollover never waits on a provider. The turns themselves are never deleted: the summary only stands in for them
// in what a new engine is handed, and transcript_get reads any of them back exact.
import { plain } from "./render.ts";
import { HANDOFF, buildHandoff, renderHandoff } from "./handoff.ts";
import type { HandoffOptions, Seed } from "./handoff.ts";
import { ROLL, contextOf, cutTo, decide } from "./rollover.ts";
import type { Context, RollDecision, RollLimits } from "./rollover.ts";
import type { Transcript } from "./store.ts";
import type { Summary, Turn } from "./types.ts";

/** The summary stays under this many characters (about 3,000 tokens): the oldest lines go first. */
export const SUMMARY_CHARS = 12_000;
/** The summary is refreshed once this many turns are waiting to be covered. */
export const SUMMARY_EVERY = 6;

export interface SummarizeInput {
  threadId: string;
  /** The summary so far, "" if none. */
  previous: string;
  /** The turns it does not yet cover, oldest first, as plain words. */
  turns: Array<{ n: number; role: Turn["role"]; who: string; text: string }>;
  maxChars: number;
}
/** The background summarizer: one call on a cheap model, on the asker's own account. */
export type Summarizer = (input: SummarizeInput) => Promise<string>;

/** The asks and the outcomes, one line each, with no model. */
export function extractiveSummary(previous: string, turns: readonly Turn[]): string {
  const lines: string[] = previous.trim() ? previous.trim().split("\n") : [];
  for (const t of turns) {
    const words = plain(t, { tools: false }).replace(/\s+/g, " ").trim();
    if (t.role === "person") lines.push(`Asked (turn ${t.n}): ${cutTo(words, 200)}`);
    else {
      const calls = t.parts.filter((p) => p.kind === "tool_call").length;
      lines.push(`Answered (turn ${t.n})${calls ? `, ${calls} tool call${calls === 1 ? "" : "s"}` : ""}: ${cutTo(words, 200) || "no words"}${t.error ? ` (failed: ${t.error.code})` : ""}`);
    }
  }
  return lines.join("\n");
}

/** Keep the newest lines whole when the summary is over its cap. */
export function fit(text: string, max: number = SUMMARY_CHARS): string {
  if (text.length <= max) return text;
  const head = "[earlier lines of this summary were dropped; transcript_search finds them]\n";
  const room = max - head.length;
  const lines = text.split("\n");
  let used = 0;
  const keep: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] ?? "";
    if (used + l.length + 1 > room) {
      // The newest line alone may be longer than the room: keep its tail rather than nothing.
      if (keep.length === 0) keep.unshift(l.slice(Math.max(0, l.length - room)));
      break;
    }
    keep.unshift(l);
    used += l.length + 1;
  }
  return head + keep.join("\n");
}

export interface RefreshOptions {
  threadId: string;
  /** Turns kept out of the summary because they go word for word. Default 20. */
  keep?: number;
  /** Waiting turns that trigger a refresh. Default 6. */
  every?: number;
  now?: () => number;
  /** The label the summary carries for who wrote it. */
  by?: string;
}

/**
 * Bring the rolling summary up to date: everything but the last `keep` turns. Returns the summary after the call (unchanged when too few turns are waiting).
 * A summarizer that throws or answers nothing is replaced by the extract; the switch that asked for the summary goes on.
 */
export async function refreshSummary(t: Transcript, summarize: Summarizer | undefined, o: RefreshOptions): Promise<Summary | null> {
  const keep = o.keep ?? HANDOFF.turns;
  const every = o.every ?? SUMMARY_EVERY;
  const count = t.count(o.threadId);
  const upTo = Math.max(0, count - keep);
  const cur = t.summary(o.threadId);
  const have = cur?.upTo ?? 0;
  if (upTo - have < every) return cur;
  const waiting = t.turns(o.threadId, have + 1).filter((x) => x.n <= upTo);
  const previous = cur?.text ?? "";
  let text = "";
  let by = o.by ?? "summarizer";
  if (summarize) {
    try {
      text = (await summarize({
        threadId: o.threadId, previous, maxChars: SUMMARY_CHARS,
        turns: waiting.map((x) => ({ n: x.n, role: x.role, who: x.authorId, text: plain(x, { tools: true }) })),
      })).trim();
    } catch { text = ""; }
  }
  if (text === "") { text = extractiveSummary(previous, waiting); by = "extract"; }
  const next: Summary = { threadId: o.threadId, text: fit(text), upTo, by, at: (o.now ?? Date.now)() };
  t.setSummary(next);
  return t.summary(o.threadId);
}

export interface RolloverCheck extends RollDecision { ctx: Context }

/** Whether this thread's window is full enough to roll now, from the engine's report (`used`) or an estimate from the characters said since `fromTurn`. */
export function rolloverCheck(
  t: Transcript,
  o: { threadId: string; used?: number; window?: number; model?: string | null; provider?: string | null; fromTurn?: number; blocked?: string | null; waited?: number; sinceRoll?: number | null; limits?: RollLimits },
): RolloverCheck {
  const chars = t.turns(o.threadId, o.fromTurn ?? 1).reduce((n, x) => n + plain(x).length, 0);
  const ctx = contextOf({ ...(o.used === undefined ? {} : { used: o.used }), ...(o.window === undefined ? {} : { window: o.window }), chars, model: o.model ?? null, provider: o.provider ?? null });
  return { ...decide({ ctx, ...(o.blocked === undefined ? {} : { blocked: o.blocked }), ...(o.waited === undefined ? {} : { waited: o.waited }), ...(o.sinceRoll === undefined ? {} : { sinceRoll: o.sinceRoll }), ...(o.limits ? { limits: o.limits } : {}) }), ctx };
}

/** The seed for a rolled session: the summary, the pointers and the last turns, built from the transcript. */
export async function rollSeed(t: Transcript, summarize: Summarizer | undefined, o: HandoffOptions & { now?: () => number }): Promise<Seed> {
  await refreshSummary(t, summarize, { threadId: o.threadId, ...(o.turns === undefined ? {} : { keep: o.turns }), ...(o.now ? { now: o.now } : {}), every: 1 });
  return renderHandoff(buildHandoff(t, o), { kind: "roll", ...(o.limits ? { limits: o.limits } : {}) });
}

export { ROLL };
