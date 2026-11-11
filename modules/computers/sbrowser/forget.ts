// An agent moved to Trash (agent.deleted: removed by a person, or a person's Assistant that went with them when they left the Space). Its Space browser profile holds its cookies and sign-ins. While the agent
// can still be brought back (agents.restore), the profile is kept, so a restored agent is still signed in; its browser is stopped, its hold and its room on the host go at once. The agents module has no event for
// an agent deleted for good (only agent.deleted, "moved to Trash", and agent.restored), so the profile is removed once the agent has been in Trash as long as Trash keeps things (30 days, the trash retention of
// governance), unless it came back first. The periodic pass (impl.ts, computers.browser_room) does the removal.
import { releaseRoom } from "../capacity.ts";
import { ensure, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { dropHold } from "./hold.ts";
import { profileIdOf } from "./policy.ts";
import { spaceBrowser } from "./port.ts";

/** How long a profile of an agent in Trash is kept: Trash's own retention (manifests/governance.ts, trash 30d). */
export const TRASH_KEEP_MS = 30 * 86_400_000;

/** agent.deleted: the agent is in Trash. Its browser stops and lets go of its hold and room; its folder stays until it has been in Trash TRASH_KEEP_MS. */
export async function browserOfDeleted(ctx: CompCtx, agentId: unknown): Promise<boolean> {
  if (typeof agentId !== "string") return false;
  const id = profileIdOf(agentId);
  if (!id) return false;
  ensure(ctx.db);
  dropHold(ctx, id);
  releaseRoom(ctx, id);
  ctx.db.run("INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES (?, ?) ON CONFLICT (profile_id) DO NOTHING", id, ctx.now());
  const sb = spaceBrowser();
  if (sb && (await sb.available().catch(() => false))) { try { await sb.stop(id); } catch { /* stopped after idle anyway */ } }
  return true;
}

/** agent.restored: back from Trash, so its profile and sign-ins stay. */
export function browserOfRestored(ctx: CompCtx, agentId: unknown): boolean {
  if (typeof agentId !== "string" || !profileIdOf(agentId)) return false;
  ensure(ctx.db);
  return ctx.db.run("DELETE FROM computers_browser_gone WHERE profile_id = ?", agentId).changes > 0;
}

/** The periodic pass: profiles of agents in Trash for longer than Trash keeps things are removed, with their sign-ins. Returns the ones removed. */
export async function forgetExpired(ctx: CompCtx): Promise<string[]> {
  ensure(ctx.db);
  const sb = spaceBrowser();
  if (!sb) return [];
  const due = rowsOf(ctx.db, "SELECT profile_id FROM computers_browser_gone WHERE deleted_at <= ?", ctx.now() - TRASH_KEEP_MS).map((r) => String(r["profile_id"]));
  if (due.length === 0 || !(await sb.available().catch(() => false))) return [];
  const done: string[] = [];
  for (const id of due) {
    try { await sb.forget(id); ctx.db.run("DELETE FROM computers_browser_gone WHERE profile_id = ?", id); done.push(id); } catch (e) {
      ctx.log.warn("sbrowser: the browser profile of an agent in Trash could not be removed; tried again later", { agentId: id, reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
    }
  }
  return done;
}
