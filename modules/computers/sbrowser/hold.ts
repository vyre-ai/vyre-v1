// A person at the controls of an agent's Space browser (owner ruling 6 Nov: while a person has taken over, the agent's tools wait). The module keeps the hold in its own table, so every chrome_* tool of the
// agent is refused here, before the call reaches the browser service, and the hold outlives a restart of that service (browserd keeps its copy in memory only; a restarted one is told again).
// A hold nobody is using ends by itself: when the person has not watched or acted for HOLD_IDLE_MS, the agent gets the controls back, so an abandoned takeover never blocks the agent for good.
import { ensure, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import type { ProfileRow, SpaceBrowser } from "./port.ts";

/** How long a takeover lasts with nobody watching or acting before the agent gets its browser back. */
export const HOLD_IDLE_MS = 15 * 60_000;
export const HELD_LINE = "A person has the controls. The tools wait until they give them back; if nobody uses them for 15 minutes, they come back to you by themselves.";

/** The tools that only look or stop: they run while a person has the controls (browserd's rule too). */
export const DURING_HOLD: ReadonlySet<string> = new Set(["chrome_status", "chrome_stop"]);

export interface Hold { profileId: string; personId: string; since: number; seen: number }

const holdRow = (ctx: Pick<CompCtx, "db">, profileId: string): Hold | null => {
  ensure(ctx.db);
  const r = rowsOf(ctx.db, "SELECT profile_id, person_id, since, seen FROM computers_browser_hold WHERE profile_id = ?", profileId)[0];
  return r ? { profileId: String(r["profile_id"]), personId: String(r["person_id"]), since: Number(r["since"]), seen: Number(r["seen"]) } : null;
};

export function setHold(ctx: Pick<CompCtx, "db" | "now">, profileId: string, personId: string): void {
  ensure(ctx.db);
  const now = ctx.now();
  ctx.db.run("DELETE FROM computers_browser_hold WHERE profile_id = ?", profileId);
  ctx.db.run("INSERT INTO computers_browser_hold (profile_id, person_id, since, seen) VALUES (?, ?, ?, ?)", profileId, personId, now, now);
}

export function dropHold(ctx: Pick<CompCtx, "db">, profileId: string): void {
  ctx.db.run("DELETE FROM computers_browser_hold WHERE profile_id = ?", profileId);
}

/** The person was there (opened the live view, sent input): the hold is in use. */
export function touchHold(ctx: Pick<CompCtx, "db" | "now">, profileId: string, personId: string): void {
  ctx.db.run("UPDATE computers_browser_hold SET seen = ? WHERE profile_id = ? AND person_id = ?", ctx.now(), profileId, personId);
}

/**
 * The hold on a profile as it stands now, or null. Asks the browser service once: someone watching, or input since `seen`, keeps it in use; a service that lost its copy (it restarted) is told again; a
 * hold unused for HOLD_IDLE_MS ends here (the agent gets the controls back and the service is told).
 */
export async function currentHold(ctx: CompCtx, sb: SpaceBrowser, profileId: string): Promise<Hold | null> {
  const h = holdRow(ctx, profileId);
  if (!h) return null;
  let row: ProfileRow | undefined;
  let answered = false;
  try { row = (await sb.profiles()).profiles.find((p) => p.profileId === profileId); answered = true; } catch { /* the service does not answer: the hold stands as it is */ }
  const now = ctx.now();
  if (row && row.takeoverBy === h.personId) {
    const last = Math.max(h.seen, row.viewers > 0 ? now : 0, row.lastActiveAt > h.since ? row.lastActiveAt : 0);
    if (last > h.seen) { ctx.db.run("UPDATE computers_browser_hold SET seen = ? WHERE profile_id = ?", last, profileId); h.seen = last; }
  }
  if (now - h.seen >= HOLD_IDLE_MS) {
    dropHold(ctx, profileId);
    try { await sb.giveBack(profileId); } catch { /* the service forgets it on its own restart */ }
    ctx.log.info("sbrowser: a takeover nobody used ended; the agent has its browser back", { profileId, personId: h.personId });
    return null;
  }
  // a service that restarted holds nothing: it is told again, so the person's input keeps reaching the page and the agent's own path through the service waits too
  if (answered && row?.takeoverBy === undefined) { try { await sb.takeover({ profileId, personId: h.personId }); } catch { /* the module's hold still refuses the agent */ } }
  return h;
}

/** Does this person hold this profile now (the module's word, not only the service's)? */
export const heldBy = (ctx: Pick<CompCtx, "db">, profileId: string): string | null => holdRow(ctx, profileId)?.personId ?? null;
