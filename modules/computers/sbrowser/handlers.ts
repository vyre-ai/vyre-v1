// What a person does with an agent's browser in the Space browser: see which ones they may watch, open the live view, take over and give back. Never an agent: an agent drives its own profile through the
// chrome_* tools. Who may watch and take over a profile is policy.ts. The profile is named by the agent.
import { ToolError } from "../handlers/tools/common.ts";
import { pageOf } from "../handlers/record.ts";
import { waitingNote } from "../capacity.ts";
import { actorOf, ensure, mintTicket, raise, redeemTicket, rowsOf, stepOf, stepOut } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { hasOwnPlace } from "../../../lib/asker-place.ts";
import { agentInfo } from "./agentinfo.ts";
import { askerProfileId, mayTakeOver, profileAccess, profileIdOf } from "./policy.ts";
import type { ProfileAccess, ProfileAgent } from "./policy.ts";
import { spaceBrowser } from "./port.ts";
import type { ProfileRow, SpaceBrowser } from "./port.ts";
import { currentHold, dropHold, heldBy, setHold, touchHold } from "./hold.ts";
import { needRoom, roomWaitLine, waitingForRoom, waitingProfiles } from "./room.ts";
import { signInSites } from "./sites.ts";

const TICKET_MS = 5 * 60_000;

function browserOrRaise(ctx: CompCtx): SpaceBrowser {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  return sb;
}

function personOf(ctx: CompCtx): string {
  if (ctx.principal.kind === "agent")
    raise(
      ctx,
      "permission.no_grant",
      "An agent drives its own browser with its tools; watching and taking over are for people.",
    );
  return actorOf(ctx);
}

/** The agent behind a profile, as policy.ts needs it; null when the caller cannot see it (gone, or private to someone else): the same answer for both. */
async function agentOf(ctx: CompCtx, agentId: string): Promise<ProfileAgent | null> {
  try {
    const r = (await ctx.call("agents.share_class", { agentId })) as {
      class?: ProfileAgent["class"];
      ownerId?: string;
      people?: string[];
    };
    if (typeof r.ownerId !== "string" || !r.class) return null;
    return { agentId, ownerId: r.ownerId, class: r.class, people: r.people ?? [] };
  } catch {
    return null;
  }
}

const isAdmin = (ctx: CompCtx): boolean =>
  ctx.authorize({ perm: "computers.use", level: "manage" }, { type: "computer", id: null }).effect === "allow";

/** The caller's right to this agent's browser, or a refusal in plain words. */
async function mayWatch(
  ctx: CompCtx,
  agentId: string,
  takeOver = false,
): Promise<{ person: string; access: Exclude<ProfileAccess, "none">; agent: ProfileAgent }> {
  const person = personOf(ctx);
  if (!profileIdOf(agentId)) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const agent = await agentOf(ctx, agentId);
  if (!agent) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const access = profileAccess(agent, person, isAdmin(ctx));
  if (access === "none")
    raise(
      ctx,
      "permission.no_grant",
      agent.class === "private"
        ? "That agent's browser is its person's alone."
        : "You cannot watch this agent's browser.",
    );
  if (takeOver && !mayTakeOver(access))
    raise(ctx, "permission.no_grant", "This agent is shared with you to watch. Its owner and admins take over.");
  return { person, access, agent };
}

/**
 * A person who uses a shared agent without owning it has a browser profile of their own (asker.ts): the live view, the controls, the steps and the sign-ins they are shown are that profile's, never the
 * owner's (lead, 14 Nov). `agentId` stays the name the app knows; the profile id is what the browser service and the tables are asked about. Undefined for the agent's owner, who is on the agent's own.
 */
async function ownProfile(ctx: CompCtx, agentId: string): Promise<{ person: string; profileId: string } | undefined> {
  if (ctx.principal.kind !== "person") return undefined;
  const person = personOf(ctx);
  if (!profileIdOf(agentId)) return undefined;
  const who = await agentInfo(ctx, agentId);
  if (!hasOwnPlace(who, agentId, person)) return undefined;
  const profileId = askerProfileId(agentId, person);
  if (!profileId) return undefined;
  // their own profile is theirs from the first call of their turn; before it exists the existing rule of who may watch the agent's browser (owner, shared people, admins) still answers
  const used = await spaceBrowser()
    ?.profileUsed(profileId)
    .catch(() => false);
  return used ? { person, profileId } : undefined;
}
/** The row of a profile as the app knows the agent: under the agent's id. */
const asAgent = <T extends { agentId: string }>(row: T, agentId: string): T => ({ ...row, agentId });

const CODES = {
  timeout: "timeout.deadline",
  paused: "provider.unavailable",
  not_found: "validation.not_found",
  bad_input: "validation.precondition_failed",
  held: "validation.precondition_failed",
  unavailable: "provider.unavailable",
} as const;
function refuse(ctx: CompCtx, e: unknown): never {
  if (e instanceof ToolError) raise(ctx, CODES[e.code], e.message.slice(0, 300), { browserd: e.code });
  raise(ctx, "provider.unavailable", "The Space browser did not answer.", {
    reason: e instanceof Error ? e.message.slice(0, 200) : "unknown",
  });
}

const rowOut = (r: ProfileRow, access: Exclude<ProfileAccess, "none">, line?: string | null) => ({
  agentId: r.profileId,
  running: r.running,
  state: line ? ("waiting" as const) : r.running ? ("running" as const) : ("asleep" as const),
  ...(line ? { line } : {}),
  tabs: r.tabs,
  busy: r.busy,
  viewers: r.viewers,
  ...(r.lastActiveAt ? { lastActiveAt: r.lastActiveAt } : {}),
  ...(r.takeoverBy ? { takeoverBy: r.takeoverBy } : {}),
  paired: r.bridge?.optin === true && r.bridge.connected > 0,
  access,
});

async function rowOf(ctx: CompCtx, sb: SpaceBrowser, agentId: string, access: Exclude<ProfileAccess, "none">) {
  const row = (await sb.profiles().catch((e: unknown) => refuse(ctx, e))).profiles.find((x) => x.profileId === agentId);
  // who has the controls is the module's word (sbrowser/hold.ts): it outlives a restart of the browser service
  const by = heldBy(ctx, agentId) ?? undefined;
  const base = row ?? {
    profileId: agentId,
    running: false,
    tabs: 0,
    busy: false,
    takeover: false,
    viewers: 0,
    lastActiveAt: 0,
    held: 0,
    paused: false,
  };
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
    // the profile this person's own turns use on a shared agent they do not own (asker.ts), listed under the agent's id; nobody sees another person's
    const dash = row.profileId.indexOf("-");
    if (dash > 0 && ctx.principal.kind === "person") {
      const agentId = row.profileId.slice(0, dash);
      if (askerProfileId(agentId, person) === row.profileId) {
        const held = heldBy(ctx, row.profileId) ?? undefined;
        const { takeoverBy: _t, ...base } = row;
        out.push(
          asAgent(
            rowOut({ ...base, takeover: held !== undefined, ...(held ? { takeoverBy: held } : {}) }, "owner"),
            agentId,
          ),
        );
        continue;
      }
    }
    const agent = await agentOf(ctx, row.profileId);
    if (!agent) continue;
    const access = profileAccess(agent, person, admin);
    const by = heldBy(ctx, row.profileId) ?? undefined;
    const { takeoverBy: _was, ...rest } = row;
    if (access !== "none")
      out.push(
        rowOut(
          { ...rest, takeover: by !== undefined, ...(by ? { takeoverBy: by } : {}) },
          access,
          waitingNote(ctx.db, row.profileId) ?? roomWaitLine(row.profileId),
        ),
      );
  }
  // a browser waiting for room has not reached the service yet: it is listed with the line
  const waiting = new Set([
    ...rowsOf(ctx.db, "SELECT claim_key FROM computers_claim WHERE kind = 'browser' AND state = 'waiting'").map((r) =>
      String(r["claim_key"]),
    ),
    ...waitingProfiles().filter((id) => roomWaitLine(id) !== null),
  ]);
  for (const id of waiting) {
    if (out.some((x) => x.agentId === id)) continue;
    const agent = await agentOf(ctx, id);
    const access = agent ? profileAccess(agent, person, admin) : "none";
    if (access !== "none")
      out.push(
        rowOut(
          {
            profileId: id,
            running: false,
            tabs: 0,
            busy: false,
            takeover: false,
            viewers: 0,
            lastActiveAt: 0,
            held: 0,
            paused: false,
          },
          access,
          waitingNote(ctx.db, id) ?? roomWaitLine(id),
        ),
      );
  }
  // the browser slots of this server, for one quiet line in Console > Computers: how many run now (every Space's on this server), how many it holds at once, how many calls wait for one
  const slots = {
    running: all.profiles.filter((p) => p.running).length,
    limit: all.maxRunning,
    waiting: waitingForRoom(),
  };
  return { profiles: out, maxRunning: all.maxRunning, slots };
}

export async function stream(ctx: CompCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const sb = browserOrRaise(ctx);
  const mine = await ownProfile(ctx, input.agentId);
  const { person, access } = mine
    ? { person: mine.person, access: "owner" as const }
    : await mayWatch(ctx, input.agentId);
  const pid = mine?.profileId ?? input.agentId;
  // the browser service wakes for a viewer; the address it gives stays in the Space, and the viewer gets the Space's own relay path with a ticket for this person (host/src/routes/browser-stream.ts)
  // the view wakes the browser: it needs room on the host like any browser that starts
  await needRoom(ctx, sb, pid);
  let size: { width?: number; height?: number } = {};
  try {
    const r = await sb.stream({ profileId: pid, personId: person });
    if (r.width && r.height) size = { width: r.width, height: r.height };
  } catch (e) {
    refuse(ctx, e);
  }
  // the person at the controls opening the view is using the hold; a service that restarted is told about it again
  if (heldBy(ctx, pid) === person) {
    touchHold(ctx, pid, person);
    await currentHold(ctx, sb, pid);
  }
  // a person who holds the controls gets a ticket that carries their input; anyone else only frames
  const row = await rowOf(ctx, sb, pid, access);
  const t = await mintTicket(ctx.db, row.takeoverBy === person ? "takeover" : "stream", pid, person, ctx.now());
  return {
    transport: "mjpeg" as const,
    url: `/browsers/${pid}/stream?ticket=${t.ticket}`,
    ws: `/browsers/${pid}/ws?ticket=${t.ticket}`,
    expiresAt: t.expiresAt,
    ...(size.width ? size : {}),
  };
}

/**
 * What the Space's relay asks when a viewer arrives (host/src/routes/browser-stream.ts): spend the ticket, get the browser service's own addresses, and say whether the person may send input. A host call, never
 * a capability: no session can reach it.
 */
export async function browserStreamOpen(
  ctx: CompCtx,
  input: { ticket: string; agentId: string },
): Promise<{ url: string; ws: string; personId: string; input: boolean } | null> {
  ensure(ctx.db);
  const sb = spaceBrowser();
  if (!sb) return null;
  const who = await redeemTicket(ctx.db, String(input.ticket), ctx.now());
  if (!who || who.computerId !== String(input.agentId) || (who.kind !== "stream" && who.kind !== "takeover"))
    return null;
  let target: Awaited<ReturnType<SpaceBrowser["stream"]>>;
  try {
    target = await sb.stream({ profileId: who.computerId, personId: who.personId });
  } catch {
    return null;
  }
  if (!target.ws || !target.url) return null;
  let holds = heldBy(ctx, who.computerId) === who.personId;
  if (holds) {
    touchHold(ctx, who.computerId, who.personId);
    holds = (await currentHold(ctx, sb, who.computerId))?.personId === who.personId;
  }
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

export const TAKEOVER_REOPENED = "This browser was reopened since you last saw it, so its page was reloaded.";

export async function takeOver(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const mine = await ownProfile(ctx, input.agentId);
  const { person, access } = mine
    ? { person: mine.person, access: "owner" as const }
    : await mayWatch(ctx, input.agentId, true);
  const pid = mine?.profileId ?? input.agentId;
  ensure(ctx.db);
  const other = heldBy(ctx, pid);
  if (other !== null && other !== person && (await currentHold(ctx, sb, pid)) !== null)
    raise(ctx, "validation.precondition_failed", "Someone else has the controls.");
  // the table first, then browserd: an agent's call that reads the table after this line waits, and one that read it before cannot undo it (browserd never releases on a call)
  setHold(ctx, pid, person);
  let got: { reopened?: boolean } | void = undefined;
  try {
    got = await sb.takeover({ profileId: pid, personId: person, space: ctx.space });
  } catch (e) {
    if (other === null) dropHold(ctx, pid);
    refuse(ctx, e);
  }
  // the browser was reopened since a person last saw it (closed to make room, or stopped when idle): its page was reloaded, and the pane says so in one line
  return {
    profile: asAgent(await rowOf(ctx, sb, pid, access), input.agentId),
    ...(got && got.reopened ? { note: TAKEOVER_REOPENED } : {}),
  };
}

export async function giveBack(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const mine = await ownProfile(ctx, input.agentId);
  const { person, access } = mine
    ? { person: mine.person, access: "owner" as const }
    : await mayWatch(ctx, input.agentId, true);
  const pid = mine?.profileId ?? input.agentId;
  ensure(ctx.db);
  const by =
    heldBy(ctx, pid) ??
    (await sb.profiles().catch(() => ({ profiles: [] as ProfileRow[] }))).profiles.find((p) => p.profileId === pid)
      ?.takeoverBy;
  // the person who has the controls gives them back; so may an admin (the person went away)
  if (by !== undefined && by !== person && access !== "admin")
    raise(ctx, "permission.no_grant", "Someone else has the controls.");
  // giving back always works: the module's hold goes first, so the agent has its tools even when the browser service does not answer now (a restarted one holds nothing)
  // the release carries when it was decided: a takeover by someone else that reaches browserd before it is not undone by it
  const decidedAt = Date.now();
  dropHold(ctx, pid);
  try {
    await sb.giveBack(pid, { before: decidedAt });
  } catch (e) {
    ctx.log.warn("sbrowser: give back did not reach the browser service", {
      agentId: input.agentId,
      reason: e instanceof Error ? e.message.slice(0, 160) : "unknown",
    });
  }
  return {
    profile: await rowOf(ctx, sb, pid, access)
      .then((r) => asAgent(r, input.agentId))
      .catch(() =>
        rowOut(
          {
            profileId: input.agentId,
            running: false,
            tabs: 0,
            busy: false,
            takeover: false,
            viewers: 0,
            lastActiveAt: 0,
            held: 0,
            paused: false,
          },
          access,
        ),
      ),
  };
}

/** The agent's browser steps, newest last: what computers.timeline gives for a computer, for a profile. */
export async function timeline(
  ctx: CompCtx,
  input: { agentId: string; runId?: string; threadId?: string; cursor?: string; limit?: number },
) {
  ensure(ctx.db);
  const mine = await ownProfile(ctx, input.agentId);
  if (!mine) await mayWatch(ctx, input.agentId);
  const args: unknown[] = [mine?.profileId ?? input.agentId];
  let sql = "SELECT * FROM computers_timeline WHERE computer_id = ?";
  if (input.runId) {
    sql += " AND run_id = ?";
    args.push(input.runId);
  }
  if (input.threadId) {
    sql += " AND thread_id = ?";
    args.push(input.threadId);
  }
  sql += " ORDER BY idx";
  const p = pageOf(rowsOf(ctx.db, sql, ...args).map(stepOf), input.cursor, input.limit);
  return { steps: p.page.map(stepOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function sessions(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const mine = await ownProfile(ctx, input.agentId);
  if (!mine) await mayWatch(ctx, input.agentId);
  try {
    return {
      sessions: signInSites(await sb.sessions(mine?.profileId ?? input.agentId)).map((x) => ({
        site: x.site,
        since: x.since,
        lastSeen: x.lastSeen,
      })),
    };
  } catch (e) {
    refuse(ctx, e);
  }
}

/**
 * The sign-ins of the profile this person's turns of the agent use: their own profile when the agent is shared with them and not theirs (sbrowser/asker.ts), the agent's own for its owner. Read as the person: it
 * never names another person's. `signedInAs` is empty: a cookie jar does not say who.
 */
export async function mySignIns(ctx: CompCtx, input: { agentId: string }) {
  const sb = browserOrRaise(ctx);
  const person = personOf(ctx);
  if (!profileIdOf(input.agentId)) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const who = await agentInfo(ctx, input.agentId);
  if (!who) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const own = hasOwnPlace(who, input.agentId, person);
  if (!own && who.ownerId !== person) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  const profile = own ? askerProfileId(input.agentId, person) : profileIdOf(input.agentId);
  if (!profile) raise(ctx, "validation.not_found", "There is no browser for that agent.");
  try {
    return {
      profile: own ? ("own" as const) : ("agent" as const),
      signIns: signInSites(await sb.sessions(profile)).map((x) => ({
        kind: "browser" as const,
        site: x.site,
        since: x.since,
        lastSeen: x.lastSeen,
      })),
    };
  } catch (e) {
    refuse(ctx, e);
  }
}

export async function signOut(ctx: CompCtx, input: { agentId: string; site: string }) {
  const sb = browserOrRaise(ctx);
  const mine = await ownProfile(ctx, input.agentId);
  if (!mine) await mayWatch(ctx, input.agentId, true);
  const pid = mine?.profileId ?? input.agentId;
  if (!/^[a-z0-9.-]{1,253}$/i.test(input.site))
    raise(ctx, "validation.bad_input", "Name the site as its host name, such as app.example.com.");
  ensure(ctx.db);
  // signing out starts the browser: it needs room on the host first
  await needRoom(ctx, sb, pid);
  try {
    return { ok: await sb.signOut(pid, input.site) };
  } catch (e) {
    refuse(ctx, e);
  }
}

export const sbrowserHandlers = {
  "computers.browser.sessions": sessions,
  "computers.browser.my_sign_ins": mySignIns,
  "computers.browser.sign_out": signOut,
  "computers.browser.timeline": timeline,
  "computers.browser.profiles": profiles,
  "computers.browser.stream": stream,
  "computers.browser.take_over": takeOver,
  "computers.browser.give_back": giveBack,
};
