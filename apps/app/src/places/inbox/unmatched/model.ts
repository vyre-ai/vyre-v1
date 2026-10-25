// Inbox > Unmatched (spec 3.3, 2.18): senders and callers that match no record yet, newest first, each with suggestions to match to. Pure: the screen reads these.
import type { CapMap } from "../../../../../../generated/types.ts";

export type UnmatchedOut = CapMap["inbox.unmatched"]["out"];
export type Unmatched = UnmatchedOut["rows"][number];
export type Suggestion = CapMap["inbox.match_suggestions"]["out"]["suggestions"][number];
export type MatchOut = CapMap["inbox.match"]["out"];
export type CreateOut = CapMap["inbox.match_new"]["out"];

export const SCREEN = "inbox.unmatched";
export const EMPTY_LINE = "Nothing waiting for a match";
export const OFFLINE_LINE = "Offline, showing your saved copy";

/** Newest first. */
export const newestFirst = (rows: readonly Unmatched[]): Unmatched[] => [...rows].sort((a, b) => b.lastMessageAt - a.lastMessageAt || a.id.localeCompare(b.id));

/** What the header says: how many wait. */
export const waitingLine = (n: number): string => (n === 0 ? "" : n === 1 ? "1 waiting for a match" : `${n} waiting for a match`);

/** The match menu: the suggestions best first with their score in the count column, then the two ways out. */
export function suggestionLabel(s: Suggestion): string {
  return s.type === "company" ? `${s.name}, company` : s.name;
}
export const scorePercent = (s: Suggestion): number => Math.round(s.score * 100);

/** The line a match leaves where it happened. */
export const matchedLine = (who: string, name: string): string => `${who} matched to ${name}`;
export const createdLine = (who: string, type: "contact" | "company"): string => `${who} saved as a new ${type}`;
