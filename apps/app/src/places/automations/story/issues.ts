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
  for (const i of mine) if (i.severity === "error") out.push({ kind: "value", line: i.message, button: connectLabel ?? "Fix" });
  return out;
}
