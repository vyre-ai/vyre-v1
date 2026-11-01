// Home's first line, true without any assistant: "Since Friday: 4 changes on your records, 5 unread messages, 2 tasks wait on you", each part a link, or "All quiet since Friday". The counts come from reads
// Home already trusts (home.activity for what changed, inbox.counts for unread mail, tasks.needs_you for what waits on the person); the pure part is here.
import { DAY_MS, dayNumber, plural } from "./model.ts";
import type { Clock } from "./model.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** When the person was last here, in the words they would use: "this morning" (same day), "yesterday", a weekday within the week, else "a while". */
export function sinceWord(since: number, c: Clock): string {
  const k = dayNumber(c.now, c.offsetMin) - dayNumber(since, c.offsetMin);
  if (k <= 0) return "this morning";
  if (k === 1) return "yesterday";
  if (c.now - since < 7 * DAY_MS) return WEEKDAYS[new Date(since + c.offsetMin * 60_000).getUTCDay()]!;
  return "a while ago";
}

export type PartKey = "changes" | "ran" | "unread" | "match" | "waiting";
export interface Counts { changes: number; unread: number; match: number; waiting: number; ran?: number }
export interface LinePart { key: PartKey; text: string }

/** The nonzero parts, in the order a person cares about: what waits on them first. */
export function lineParts(n: Counts): LinePart[] {
  const out: LinePart[] = [];
  if (n.waiting > 0) out.push({ key: "waiting", text: `${plural(n.waiting, "task")} ${n.waiting === 1 ? "waits" : "wait"} on you` });
  if (n.unread > 0) out.push({ key: "unread", text: plural(n.unread, "unread message") });
  if (n.match > 0) out.push({ key: "match", text: `${plural(n.match, "sender")} to match` });
  if ((n.ran ?? 0) > 0) out.push({ key: "ran", text: `${plural(n.ran!, "flow")} ran for you` });
  if (n.changes > 0) out.push({ key: "changes", text: `${plural(n.changes, "record")} you follow changed` });
  return out;
}

/** The lead words: "Since Friday:", or the all-clear sentence when nothing is counted. */
export function lead(parts: readonly LinePart[], word: string): string {
  return parts.length === 0 ? `All quiet since ${word}.` : `Since ${word}:`;
}
