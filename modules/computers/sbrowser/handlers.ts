// What a person does with an agent's browser in the Space browser: see which ones they may watch, open the live view, take over and give back. Never an agent: an agent drives its own profile through the
// chrome_* tools. Who may watch and take over a profile is policy.ts. The profile is named by the agent.
import { ToolError } from "../handlers/tools/common.ts";
import { pageOf } from "../handlers/record.ts";
import { waitingNote } from "../capacity.ts";
import { actorOf, ensure, mintTicket, raise, redeemTicket, rowsOf, stepOf, stepOut } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { mayTakeOver, profileAccess, profileIdOf } from "./policy.ts";
import type { ProfileAccess, ProfileAgent } from "./policy.ts";
import { spaceBrowser } from "./port.ts";
import type { ProfileRow, SpaceBrowser } from "./port.ts";
import { currentHold, dropHold, heldBy, setHold, touchHold } from "./hold.ts";
import { needRoom } from "./room.ts";

const TICKET_MS = 5 * 60_000;

function browserOrRaise(ctx: CompCtx): SpaceBrowser {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  return sb;
}

function personOf(ctx: CompCtx): string {
  if (ctx.principal.kind === "agent") raise(ctx, "permission.no_grant", "An agent drives its own browser with its tools; watching and taking over are for people.");
  return actorOf(ctx);
}

/** The agent behind a profile, as policy.ts needs it; null when the caller cannot see it (gone, or private to someone else): the same answer for both. */
async function agentOf(ctx: CompCtx, agentId: string): Promise<ProfileAgent | null> {
  try {
    const r = (await ctx.call("agents.share_class", { agentId })) as { class?: ProfileAgent["class"]; ownerId?: string; people?: string[] };
    if (typeof r.ownerId !== "string" || !r.class) return null;
    return { agentId, ownerId: r.ownerId, class: r.class, people: r.people ?? [] };
  } catch { return null; }
}

const isAdmin = (ctx: CompCtx): boolean => ctx.authorize({ perm: "computers.use", level: "manage" }, { type: "computer", id: null }).effect === "allow";

/** The caller's right to this agent's browser, or a refusal in plain words. */
async function mayWatch(ctx: CompCtx, agentId: string, takeOver = false): Promise<{ person: string; access: Exclude<ProfileAccess, "none">; agent: ProfileAgent }> {
  const person = personOf(ctx);
  if (!profileIdOf(agentId)) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const agent = await agentOf(ctx, agentId);
  if (!agent) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const access = profileAccess(agent, person, isAdmin(ctx));
  if (access === "none") raise(ctx, "permission.no_grant", agent.class === "private" ? "That agent's browser is its person's alone." : "You cannot watch this agent's browser.");
  if (takeOver && !mayTakeOver(access)) raise(ctx, "permission.no_grant", "This agent is shared with you to watch. Its owner and admins take over.");
  return { person, access, agent };
}

const CODES = { timeout: "timeout.deadline", paused: "provider.unavailable", not_found: "validation.not_found", bad_input: "validation.precondition_failed", held: "validation.precondition_failed", unavailable: "provider.unavailable" } as const;
function refuse(ctx: CompCtx, e: unknown): never {
  if (e instanceof ToolError) raise(ctx, CODES[e.code], e.message.slice(0, 300), { browserd: e.code });
  raise(ctx, "provider.unavailable", "The Space browser did not answer.", { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
}

const rowOut = (r: ProfileRow, access: Exclude<ProfileAccess, "none">, line?: string | null) => ({
  agentId: r.profileId, running: r.running, state: line ? ("waiting" as const) : r.running ? ("running" as const) : ("asleep" as const), ...(line ? { line } : {}), tabs: r.tabs, busy: r.busy, viewers: r.viewers, ...(r.lastActiveAt ? { lastActiveAt: r.lastActiveAt } : {}),
  ...(r.takeoverBy ? { takeoverBy: r.takeoverBy } : {}), paired: r.bridge?.optin === true && r.bridge.connected > 0, access,
});

async function rowOf(ctx: CompCtx, sb: SpaceBrowser, agentId: string, access: Exclude<ProfileAccess, "none">) {
  const row = (await sb.profiles().catch((e: unknown) => refuse(ctx, e))).profiles.find((x) => x.profileId === agentId);
  // who has the controls is the module's word (sbrowser/hold.ts): it outlives a restart of the browser service
  const by = heldBy(ctx, agentId) ?? undefined;
  const base = row ?? { profileId: agentId, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false };
  const { takeoverBy: _was, ...rest } = base;
  return rowOut({ ...rest, takeover: by !== undefined, ...(by ? { takeoverBy: by } : {}) }, access);
}

export async function profiles(ctx: CompCtx, _input: Record<string, never>) {
  const sb = browserOrRaise(ctx);
  const person = personOf(ctx);
  const all = await sb.profiles().catch((e: unknown) => refuse(ctx, e));
  const admin = isAdmin(ctx);
  const out = [];
  for (const row of all.profiles) {
    const agent = await agentOf(ctx, row.profileId);
    if (!agent) continue;
    const access = profileAccess(agent, person, admin);
    const by = heldBy(ctx, row.profileId) ?? undefined;
    const { takeoverBy: _was, ...rest } = row;
    if (access !== "none") out.push(rowOut({ ...rest, takeover: by !== undefined, ...(by ? { takeoverBy: by } : {}) }, access, waitingNote(ctx.db, row.profileId)));
  }
  // a browser waiting for room has not reached the service yet: it is listed with the line
  for (const r of rowsOf(ctx.db, "SELECT claim_key FROM computers_claim WHERE kind = 'browser' AND state = 'waiting'")) {
    const id = String(r["claim_key"]);
    if (out.some((x) => x.agentId === id)) continue;
    const agent = await agentOf(ctx, id);
    const access = agent ? profileAccess(agent, person, admin) : "none";
    if (access !== "none") out.push(rowOut({ profileId: id, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false }, access, waitingNote(ctx.db, id)));
  }
  return { profiles: out, maxRunning: all.maxRunning };
}

export async function stream(ctx: CompCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId);
  // the browser service wakes for a viewer; the address it gives stays in the Space, and the viewer gets the Space's own relay path with a ticket for this person (host/src/routes/browser-stream.ts)
  // the view wakes the browser: it needs room on the host like any browser that starts
  await needRoom(ctx, sb, input.agentId);
  let size: { width?: number; height?: number } = {};
  try { const r = await sb.stream({ profileId: input.agentId }); if (r.width && r.height) size = { width: r.width, height: r.height }; } catch (e) { refuse(ctx, e); }
  // the person at the controls opening the view is using the hold; a service that restarted is told about it again
  if (heldBy(ctx, input.agentId) === person) { touchHold(ctx, input.agentId, person); await currentHold(ctx, sb, input.agentId); }
  // a person who holds the controls gets a ticket that carries their input; anyone else only frames
  const row = await rowOf(ctx, sb, input.agentId, access);
  const t = await mintTicket(ctx.db, row.takeoverBy === person ? "takeover" : "stream", input.agentId, person, ctx.now());
  return { transport: "mjpeg" as const, url: `/browsers/${input.agentId}/stream?ticket=${t.ticket}`, ws: `/browsers/${input.agentId}/ws?ticket=${t.ticket}`, expiresAt: t.expiresAt, ...(size.width ? size : {}) };
}

/**
 * What the Space's relay asks when a viewer arrives (host/src/routes/browser-stream.ts): spend the ticket, get the browser service's own addresses, and say whether the person may send input. A host call, never
 * a capability: no session can reach it.
 */
export async function browserStreamOpen(ctx: CompCtx, input: { ticket: string; agentId: string }): Promise<{ url: string; ws: string; personId: string; input: boolean } | null> {
  ensure(ctx.db);
  const sb = spaceBrowser();
  if (!sb) return null;
  const who = await redeemTicket(ctx.db, String(input.ticket), ctx.now());
  if (!who || who.computerId !== String(input.agentId) || (who.kind !== "stream" && who.kind !== "takeover")) return null;
  let target: Awaited<ReturnType<SpaceBrowser["stream"]>>;
  try { target = await sb.stream({ profileId: who.computerId }); } catch { return null; }
  if (!target.ws || !target.url) return null;
  let holds = heldBy(ctx, who.computerId) === who.personId;
  if (holds) { touchHold(ctx, who.computerId, who.personId); holds = (await currentHold(ctx, sb, who.computerId))?.personId === who.personId; }
  return { url: target.url, ws: target.ws, personId: who.personId, input: who.kind === "takeover" && holds };
}

/** Does this person still hold the controls of this agent's browser? */
export async function browserStreamInput(ctx: CompCtx, input: { agentId: string; personId: string }): Promise<boolean> {
  ensure(ctx.db);
  if (!spaceBrowser()) return false;
  const held = heldBy(ctx, String(input.agentId)) === String(input.personId);
  if (held) touchHold(ctx, String(input.agentId), String(input.personId));
  return held;
}

export async function takeOver(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId, true);
  ensure(ctx.db);
  const other = heldBy(ctx, input.agentId);
  if (other !== null && other !== person && (await currentHold(ctx, sb, input.agentId)) !== null) raise(ctx, "validation.precondition_failed", "Someone else has the controls.");
  try { await sb.takeover({ profileId: input.agentId, personId: person }); } catch (e) { refuse(ctx, e); }
  setHold(ctx, input.agentId, person);
  return { profile: await rowOf(ctx, sb, input.agentId, access) };
}

export async function giveBack(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId, true);
  ensure(ctx.db);
  const by = heldBy(ctx, input.agentId) ?? (await sb.profiles().catch(() => ({ profiles: [] as ProfileRow[] }))).profiles.find((p) => p.profileId === input.agentId)?.takeoverBy;
  // the person who has the controls gives them back; so may an admin (the person went away)
  if (by !== undefined && by !== person && access !== "admin") raise(ctx, "permission.no_grant", "Someone else has the controls.");
  // giving back always works: the module's hold goes first, so the agent has its tools even when the browser service does not answer now (a restarted one holds nothing)
  dropHold(ctx, input.agentId);
  try { await sb.giveBack(input.agentId); } catch (e) { ctx.log.warn("sbrowser: give back did not reach the browser service", { agentId: input.agentId, reason: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); }
  return { profile: await rowOf(ctx, sb, input.agentId, access).catch(() => rowOut({ profileId: input.agentId, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false }, access)) };
}

/** The agent's browser steps, newest last: what computers.timeline gives for a computer, for a profile. */
export async function timeline(ctx: CompCtx, input: { agentId: string; runId?: string; threadId?: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  await mayWatch(ctx, input.agentId);
  const args: unknown[] = [input.agentId];
  let sql = "SELECT * FROM computers_timeline WHERE computer_id = ?";
  if (input.runId) { sql += " AND run_id = ?"; args.push(input.runId); }
  if (input.threadId) { sql += " AND thread_id = ?"; args.push(input.threadId); }
  sql += " ORDER BY idx";
  const p = pageOf(rowsOf(ctx.db, sql, ...args).map(stepOf), input.cursor, input.limit);
  return { steps: p.page.map(stepOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function sessions(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  await mayWatch(ctx, input.agentId);
  try { return { sessions: (await sb.sessions(input.agentId)).map((x) => ({ site: x.site, since: x.since, lastSeen: x.lastSeen })) }; } catch (e) { refuse(ctx, e); }
}

export async function signOut(ctx: CompCtx, input: { agentId: string; site: string }) {
  const sb = browserOrRaise(ctx);
  await mayWatch(ctx, input.agentId, true);
  if (!/^[a-z0-9.-]{1,253}$/i.test(input.site)) raise(ctx, "validation.bad_input", "Name the site as its host name, such as app.example.com.");
  ensure(ctx.db);
  // signing out starts the browser: it needs room on the host first
  await needRoom(ctx, sb, input.agentId);
  try { return { ok: await sb.signOut(input.agentId, input.site) }; } catch (e) { refuse(ctx, e); }
}

export const sbrowserHandlers = {
  "computers.browser.sessions": sessions,
  "computers.browser.sign_out": signOut,
  "computers.browser.timeline": timeline,
  "computers.browser.profiles": profiles,
  "computers.browser.stream": stream,
  "computers.browser.take_over": takeOver,
  "computers.browser.give_back": giveBack,
};
