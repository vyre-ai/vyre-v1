// The composer's model menu and its live lists (engine.models.list, modules/engine/live-models.ts). Opening the menu asks with `refresh`: the answer is the saved list, at once, and the server
// asks each subscription engine (Codex, Claude Code, Grok) for its list behind it. When a refresh is running the menu asks once more with `wait` and swaps in the fresh list, so a model the
// vendor just added shows up as its own row, named the way the vendor names it. The menu never waits on that second answer, and says how fresh the list is in one quiet line.

/** A row of engine.models.list as the menu reads it. */
export interface ListedModel {
  model: string; title: string; contextTokens?: number; allowed: boolean; reason?: string; resetsAt?: number;
  alias?: string; isDefault?: boolean; efforts?: string[]; defaultEffort?: string;
}
export interface Listed { source: "live" | "saved" | "shipped"; updatedAt?: number; refreshing: boolean; failed: boolean }
export interface ModelsOut { models?: ListedModel[]; listed?: Listed }

/** A row of the panel (ui/src/Composer/ModelPanel.tsx PanelModel, plus what it does not draw yet). */
export interface MenuModel { id: string; title: string; note?: string; window?: number; allowed?: boolean; reason?: string; alias?: string; efforts?: readonly string[] }

/** "Out of usage until 3:40 PM": a model the provider refused for its usage limit, with when it comes back when the provider said (a later day names the day). */
export function outOfUsage(resetsAt: number | undefined, now = Date.now()): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= now) return "Out of usage for now";
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(now).toDateString() === at.toDateString() ? `Out of usage until ${time}` : `Out of usage until ${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** Why a model is greyed, in the panel's words. */
export function modelReason(m: { reason?: string; resetsAt?: number }, now = Date.now()): string | undefined {
  if (!m.reason) return undefined;
  if (m.reason === "not_connected") return "Not connected";
  if (m.reason === "usage_limit") return outOfUsage(m.resetsAt, now);
  return "Not allowed here";
}

/** The panel's rows: the vendor's name for each model, the vendor's default marked Default (as Auto is marked "Picks per message"), a greyed row with its reason. */
export function menuModels(out: ModelsOut | undefined, now = Date.now()): MenuModel[] {
  return (out?.models ?? []).map((m) => {
    const why = modelReason(m, now);
    const note = m.model === "auto" ? "Picks per message" : m.isDefault ? "Default" : undefined;
    return {
      id: m.model, title: m.title, ...(m.contextTokens ? { window: m.contextTokens } : {}), allowed: m.allowed, ...(why ? { reason: why } : {}), ...(note ? { note } : {}),
      ...(m.alias ? { alias: m.alias } : {}), ...(m.efforts ? { efforts: m.efforts } : {}),
    };
  });
}

/** The row a saved pick is: its id, or the row its alias resolves to today (a pick of "opus" is the current Opus). */
export function pickedRow(models: readonly { id: string; alias?: string }[] | null, pick: string | null): string | null {
  if (!pick || !models) return pick;
  if (models.some((m) => m.id === pick)) return pick;
  return models.find((m) => m.alias === pick)?.id ?? pick;
}

/** The menu's quiet line: "Updated just now" right after a list came back, "Couldn't refresh, showing saved list" when the vendor did not answer, nothing otherwise. */
export function listedLine(l: Listed | undefined): string | undefined {
  if (!l || l.refreshing) return undefined;
  if (l.failed) return "Couldn't refresh, showing saved list";
  return l.source === "live" ? "Updated just now" : undefined;
}

type Call = (cap: string, input: unknown) => unknown;

/**
 * Read the menu's list: `show` gets the saved list at once, then the fresh one when a refresh was running. `alive` false (the menu closed, the account changed) drops what comes after.
 * A failed first call shows an empty list; a failed second call keeps the first.
 */
export async function loadMenuModels(call: Call, input: Record<string, unknown>, show: (models: MenuModel[], line: string | undefined) => void, alive: () => boolean, now: () => number = Date.now): Promise<void> {
  let first: ModelsOut | undefined;
  try { first = (await Promise.resolve(call("engine.models.list", { ...input, refresh: true }))) as ModelsOut | undefined; }
  catch { if (alive()) show([], undefined); return; }
  if (!alive()) return;
  show(menuModels(first, now()), listedLine(first?.listed));
  if (first?.listed?.refreshing !== true) return;
  try {
    const second = (await Promise.resolve(call("engine.models.list", { ...input, wait: true }))) as ModelsOut | undefined;
    // a refresh still running after the wait says nothing yet; the next opening shows it
    if (alive() && second?.models) show(menuModels(second, now()), listedLine(second.listed));
  } catch { /* the saved list stays */ }
}
