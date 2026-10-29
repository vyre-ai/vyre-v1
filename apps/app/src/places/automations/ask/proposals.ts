// Step proposals from an in-memory draft_connector result. Nothing is fetched or promoted.
// Only key, effect, method, and path are copied. A path stays off the proposal.

export interface DraftAction {
  key: string;
  effect: "read" | "outward";
  method?: string;
  path?: string;
}

export interface StepProposal {
  action: string;
  effect: "read" | "outward";
  check: "dry_run" | "hold";
  title: string;
  say: string;
}

const READ_SAY = "A read can be tried with the saved connection.";
const HOLD_SAY = "An outward call waits until you run it.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Actions from a draft_connector result. Values, urls, headers, and examples are not copied. */
export function actionsFrom(out: unknown): DraftAction[] {
  if (!isRecord(out) || !Array.isArray(out.actions)) return [];
  const actions: DraftAction[] = [];
  for (const row of out.actions) {
    if (!isRecord(row)) continue;
    const key = row.key;
    const effect = row.effect;
    if (typeof key !== "string" || key.length === 0) continue;
    if (effect !== "read" && effect !== "outward") continue;
    const action: DraftAction = { key, effect };
    if (typeof row.method === "string") action.method = row.method;
    if (typeof row.path === "string") action.path = row.path;
    actions.push(action);
  }
  return actions;
}

/** One proposal per action, in order. Path and method never enter the text. */
export function proposalsFrom(actions: readonly DraftAction[]): StepProposal[] {
  return actions.map((action) => ({
    action: action.key,
    effect: action.effect,
    check: action.effect === "read" ? "dry_run" : "hold",
    title: action.key,
    say: action.effect === "read" ? READ_SAY : HOLD_SAY,
  }));
}
