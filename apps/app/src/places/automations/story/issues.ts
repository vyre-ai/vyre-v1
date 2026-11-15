// A step's missing things, from the issues the check and the server raise (their words come from lib/words/step-missing.ts on the server: this file adds none of its own).
import type { Need } from "./model.ts";

export interface IssueLite {
  nodeId?: string;
  severity: string;
  message: string;
}

/** `noAccess`: the ids of steps whose app this person may not use; their warning is the one plain line, shown first. */
export function needsFromIssues(
  issues: readonly IssueLite[],
  nodeId: string,
  noAccess: ReadonlySet<string>,
  /** The step is missing an account: its one button says what to connect. */
  connectLabel?: string,
): Need[] {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const out: Need[] = [];
  if (noAccess.has(nodeId)) {
    const w = mine.find((i) => i.severity === "warning");
    if (w) out.push({ kind: "no_access", line: w.message, button: "Ask an admin" });
  }
  // one thing is asked at a time: the first missing thing shows, the next appears when it is done
  const first = mine.find((i) => i.severity === "error");
  if (first) {
    const act = actOf(first.message);
    out.push({ kind: "value", line: act, button: connectLabel ?? act });
  }
  return out;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * What to do, as one short sentence that is also the button's name ("Add a title", "Choose who it is for"). It never repeats the step's name and never says "needs" or "(required)".
 * The server writes "<Step>: add a title." from lib/words/step-missing.ts; the page's own check writes "<Step> needs a title." and gets the same shape.
 */
export function actOf(message: string): string {
  const colon = /^[^:]{1,60}:\s+(.+?)\.?$/.exec(message);
  if (colon?.[1]) return cap(colon[1].replace(/\s*\(required\)/g, ""));
  const needs = /\bneeds\s+((?:a |an |the )?[^.,:]+?)\.?$/.exec(message);
  if (needs?.[1]) return `Add ${needs[1]}`;
  return cap(message.replace(/\.$/, ""));
}
