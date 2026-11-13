// An agent moved to Trash (agent.deleted: removed by a person, or a person's Assistant that went with them when they left the Space). Its Space browser profile holds its cookies and sign-ins. While the agent
// can still be brought back (agents.restore), the profile is kept, so a restored agent is still signed in; its browser is stopped, its hold and its room on the host go at once. The agents module has no event for
// an agent deleted for good (only agent.deleted, "moved to Trash", and agent.restored), so the profile is removed once the agent has been in Trash as long as Trash keeps things (the Space's trash retention,
// read from governance at run time; 30 days by default), unless it came back first. Lane f-terminal keeps workspace volumes by the same rule (lead, 12 Nov). The periodic pass (impl.ts, computers.browser_room) does the removal.
import { releaseRoom } from "../capacity.ts";
import { ensure, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { dropHold } from "./hold.ts";
import { askerProfileId, profileIdOf } from "./policy.ts";
import { spaceBrowser } from "./port.ts";

/** How long a profile of an agent in Trash is kept when the Space's own Trash retention cannot be read: governance's default for trash (manifests/governance.ts, '30d'; test/trash-retention.test.ts holds them together). */
export const TRASH_KEEP_MS = 30 * 86_400_000;

/** A retention value as governance writes it ("30d", "12w", "6m", "2y", "forever") in ms; null for forever; undefined when it is not one of those. */
export function retentionMs(v: string): number | null | undefined {
  if (v === "forever") return null;
  const m = /^(\d{1,5})([dwmy])$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return n * { d: 1, w: 7, m: 30, y: 365 }[m[2] as "d" | "w" | "m" | "y"] * 86_400_000;
}

/** The Space's Trash retention in force (an admin may change it), read from governance at run time; its default when that cannot be read. null: Trash is kept forever, so nothing is removed. */
export async function trashKeepMs(ctx: CompCtx): Promise<number | null> {
  try {
    const out = (await ctx.call("governance.retention.get", {})) as { kinds?: Array<{ key?: string; value?: string }> };
    const v = out.kinds?.find((k) => k.key === "trash")?.value;
    const ms = typeof v === "string" ? retentionMs(v) : undefined;
    if (ms !== undefined) return ms;
  } catch {
    /* governance is not running here (a Personal Space has no retention settings): its default */
  }
  return TRASH_KEEP_MS;
}

/**
 * The profiles the people who use a shared agent without owning it have on it (asker.ts): one per person of the Space, by the id that person's turns use. A person who has left the Space is not in the list;
 * their profile is not found here (a profile that was never made is skipped at the service).
 */
async function askerProfiles(ctx: CompCtx, agentId: string): Promise<string[]> {
  try {
    const out = (await ctx.call("access.principals.list", {})) as {
      principals?: Array<{ kind?: string; id?: string }>;
    };
    return (out.principals ?? [])
      .filter((p) => p.kind === "person" && typeof p.id === "string")
      .map((p) => askerProfileId(agentId, p.id as string))
      .filter((x): x is string => x !== null);
  } catch {
    return [];
  }
}

/** agent.deleted: the agent is in Trash. Its browser stops and lets go of its hold and room; its folder stays until it has been in Trash TRASH_KEEP_MS. */
export async function browserOfDeleted(ctx: CompCtx, agentId: unknown): Promise<boolean> {
  if (typeof agentId !== "string") return false;
  const id = profileIdOf(agentId);
  if (!id) return false;
  ensure(ctx.db);
  dropHold(ctx, id);
  releaseRoom(ctx, id);
  ctx.db.run(
    "INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES (?, ?) ON CONFLICT (profile_id) DO NOTHING",
    id,
    ctx.now(),
  );
  const sb = spaceBrowser();
  if (sb && (await sb.available().catch(() => false))) {
    for (const p of [id, ...(await askerProfiles(ctx, agentId))]) {
      try {
        await sb.stop(p);
      } catch {
        /* stopped after idle anyway */
      }
    }
  }
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
  if (rowsOf(ctx.db, "SELECT 1 FROM computers_browser_gone LIMIT 1").length === 0) return [];
  const keep = await trashKeepMs(ctx);
  if (keep === null) return [];
  const due = rowsOf(
    ctx.db,
    "SELECT profile_id FROM computers_browser_gone WHERE deleted_at <= ?",
    ctx.now() - keep,
  ).map((r) => String(r["profile_id"]));
  if (due.length === 0 || !(await sb.available().catch(() => false))) return [];
  const done: string[] = [];
  for (const id of due) {
    try {
      await sb.forget(id);
      // what the people who use the agent without owning it signed in to goes with it
      for (const p of await askerProfiles(ctx, id)) await sb.forget(p).catch(() => undefined);
      ctx.db.run("DELETE FROM computers_browser_gone WHERE profile_id = ?", id);
      done.push(id);
    } catch (e) {
      ctx.log.warn("sbrowser: the browser profile of an agent in Trash could not be removed; tried again later", {
        agentId: id,
        reason: e instanceof Error ? e.message.slice(0, 160) : "unknown",
      });
    }
  }
  return done;
}
