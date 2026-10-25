// Vault health (spec 2.17): which items are weak, reused, stale or due for rotation. Breach checks are deferred. The words are the screen's; the list is vault.health, never a value.
import type { Health } from "../layout/model.ts";

export type Issue = Health["items"][number]["issues"][number];

export const ISSUE_WORDS: Readonly<Record<Issue, string>> = {
  weak: "Weak, easy to guess",
  reused: "The same value is on another item",
  stale: "Not changed in a long time",
  rotation_due: "Its rotation reminder has passed",
};

export const ISSUE_SHORT: Readonly<Record<Issue, string>> = { weak: "weak", reused: "reused", stale: "stale", rotation_due: "rotation due" };

/** "2 weak, 1 reused, 3 stale": only the kinds that have something; "All clear" when nothing does. */
export function summaryWords(h: Pick<Health, "weak" | "reused" | "stale" | "rotationDue">): string {
  const parts: string[] = [];
  if (h.weak) parts.push(`${h.weak} weak`);
  if (h.reused) parts.push(`${h.reused} reused`);
  if (h.stale) parts.push(`${h.stale} stale`);
  if (h.rotationDue) parts.push(`${h.rotationDue} rotation due`);
  return parts.length ? parts.join(", ") : "All clear";
}

export const issueLine = (issues: readonly Issue[]): string => issues.map((i) => ISSUE_WORDS[i]).join(" · ");

/** Worst first: more issues above fewer, then by name. */
export function worstFirst(items: Health["items"]): Health["items"] {
  return [...items].sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
}
