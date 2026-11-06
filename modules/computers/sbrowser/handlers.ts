// What a person does with an agent's browser in the Space browser: see which ones they may watch, open the live view, take over and give back. Never an agent: an agent drives its own profile through the
// chrome_* tools. Who may watch and take over a profile is policy.ts. The profile is named by the agent.
import { ToolError } from "../handlers/tools/common.ts";
import { actorOf, ensure, mintTicket, raise, redeemTicket } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { mayTakeOver, profileAccess, profileIdOf } from "./policy.ts";
import type { ProfileAccess, ProfileAgent } from "./policy.ts";
import { spaceBrowser } from "./port.ts";
import type { ProfileRow, SpaceBrowser } from "./port.ts";

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

const rowOut = (r: ProfileRow, access: Exclude<ProfileAccess, "none">) => ({
  agentId: r.profileId, running: r.running, tabs: r.tabs, busy: r.busy, viewers: r.viewers, ...(r.lastActiveAt ? { lastActiveAt: r.lastActiveAt } : {}),
  ...(r.takeoverBy ? { takeoverBy: r.takeoverBy } : {}), paired: r.bridge?.optin === true && r.bridge.connected > 0, access,
});

async function rowOf(ctx: CompCtx, sb: SpaceBrowser, agentId: string, access: Exclude<ProfileAccess, "none">) {
  const row = (await sb.profiles().catch((e: unknown) => refuse(ctx, e))).profiles.find((x) => x.profileId === agentId);
  return rowOut(row ?? { profileId: agentId, running: false, tabs: 0, busy: false, takeover: false, viewers: 0, lastActiveAt: 0, held: 0, paused: false }, access);
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
    if (access !== "none") out.push(rowOut(row, access));
  }
  return { profiles: out, maxRunning: all.maxRunning };
}

export async function stream(ctx: CompCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId);
  // the browser service wakes for a viewer; the address it gives stays in the Space, and the viewer gets the Space's own relay path with a ticket for this person (host/src/routes/browser-stream.ts)
  try { await sb.stream({ profileId: input.agentId }); } catch (e) { refuse(ctx, e); }
  // a person who holds the controls gets a ticket that carries their input; anyone else only frames
  const row = await rowOf(ctx, sb, input.agentId, access);
  const t = await mintTicket(ctx.db, row.takeoverBy === person ? "takeover" : "stream", input.agentId, person, ctx.now());
  return { transport: "mjpeg" as const, url: `/browsers/${input.agentId}/stream?ticket=${t.ticket}`, ws: `/browsers/${input.agentId}/ws?ticket=${t.ticket}`, expiresAt: t.expiresAt };
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
  const holds = (await sb.profiles().catch(() => ({ profiles: [] as ProfileRow[] }))).profiles.find((p) => p.profileId === who.computerId)?.takeoverBy === who.personId;
  return { url: target.url, ws: target.ws, personId: who.personId, input: who.kind === "takeover" && holds };
}

/** Does this person still hold the controls of this agent's browser? */
export async function browserStreamInput(_ctx: CompCtx, input: { agentId: string; personId: string }): Promise<boolean> {
  const sb = spaceBrowser();
  if (!sb) return false;
  return (await sb.profiles().catch(() => ({ profiles: [] as ProfileRow[] }))).profiles.find((p) => p.profileId === String(input.agentId))?.takeoverBy === String(input.personId);
}

export async function takeOver(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId, true);
  try { await sb.takeover({ profileId: input.agentId, personId: person }); } catch (e) { refuse(ctx, e); }
  return { profile: await rowOf(ctx, sb, input.agentId, access) };
}

export async function giveBack(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const { person, access } = await mayWatch(ctx, input.agentId, true);
  const now = await rowOf(ctx, sb, input.agentId, access);
  // the person who has the controls gives them back; so may an admin (the person went away)
  if (now.takeoverBy !== undefined && now.takeoverBy !== person && access !== "admin") raise(ctx, "permission.no_grant", "Someone else has the controls.");
  try { await sb.giveBack(input.agentId); } catch (e) { refuse(ctx, e); }
  return { profile: await rowOf(ctx, sb, input.agentId, access) };
}

export const sbrowserHandlers = {
  "computers.browser.profiles": profiles,
  "computers.browser.stream": stream,
  "computers.browser.take_over": takeOver,
  "computers.browser.give_back": giveBack,
};
