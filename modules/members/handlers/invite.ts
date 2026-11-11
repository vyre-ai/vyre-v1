// Invites and the join (spec 3.13, ARCH 7.13). An invite carries a role, groups, the agents, projects and channels the person starts in, and an expiry.
// The link is the Space address, a one-time code and the Space key fingerprint (as a fragment, so the server never sees it). The code is stored as a hash.
// The accept is the pre-auth path: members.accept checks the invite, asks identity to make the account (ruling 23, identity emits member.joined and principal.created once),
// then runs the join effects. The same effects run from the seam identity calls when a host drives identity directly, so they never depend on which door the person used.
import { currentPolicy, enabledProviders } from "./policy.ts";
import { companyConnected } from "./company.ts";
import type { MembersCtx, InviteRow, SeamInvite } from "../projections.ts";
import {
  DAY_MS, DEFAULT_EXPIRY_DAYS, EVERYONE, GUEST_ROLE, OWNER_ROLE, hashCode, inviteById, inviteByCode, inviteView, invitesAll, listOf, mustInvite, newCode, nid, normCode, page, raise, stateOf,
} from "../projections.ts";

import { oneAtATime } from "../../../lib/one-at-a-time.ts";

const ok = { ok: true } as const;
type Dev = "desktop" | "phone" | "web" | "extension" | "daemon";

interface SpaceInfo { id: string; name: string; logoFileId?: string; fingerprint: string; host?: string }

export async function spaceInfo(ctx: MembersCtx): Promise<SpaceInfo> {
  const out = (await ctx.call("spaces.get", {})) as { space: { id: string; name: string; logoFileId?: string; fingerprint: string; address?: { host?: string } } };
  const s = out.space;
  const info: SpaceInfo = { id: s.id, name: s.name, fingerprint: s.fingerprint };
  if (s.logoFileId) info.logoFileId = s.logoFileId;
  if (s.address?.host) info.host = s.address.host;
  return info;
}

export async function roleName(ctx: MembersCtx, roleId: string): Promise<string> {
  const out = (await ctx.call("access.roles.get", { roleId })) as { role: { name: string } };
  return out.role.name;
}

/**
 * The link a person opens. On a Space reached at its phone address the relay serves the page, so everything secret rides in the fragment, which never reaches a server: the code, and the invite's own
 * key in place of the box key (the relay shell pins it for this invite alone and opens /join/<code> through the box). Elsewhere the code is in the path, as the app and `vyre://join` read it.
 */
async function linkFor(ctx: MembersCtx, host: string, info: SpaceInfo, code: string): Promise<string> {
  const fp = info.fingerprint.replace(/\s+/g, "");
  const key = await ctx.phoneInvite?.keyFor(hashCode(code)).catch(() => null);
  if (key && /^[A-Za-z0-9_-]{43}$/.test(key)) return `https://${host}/join#${new URLSearchParams({ c: code, k: key, fp })}`;
  return `https://${host}/join/${code}#fp=${fp}`;
}

function cleanIds(trace: string, what: string, ids: readonly string[] | undefined, prefix: string): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!id.startsWith(`${prefix}_`)) raise(trace, "validation.bad_input", `${what} must be ${prefix}_ ids`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export async function invitesList(ctx: MembersCtx, input: { state?: "open" | "accepted" | "revoked" | "expired"; cursor?: string; limit?: number }) {
  const now = ctx.now();
  const all = invitesAll(ctx).map((r) => inviteView(r, now)).filter((v) => !input.state || v.state === input.state);
  const p = page(all, input.cursor, input.limit);
  return { invites: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function invitesCreate(ctx: MembersCtx, input: {
  role: string; email?: string; groups?: string[]; agents?: string[]; projects?: string[]; channels?: string[]; expiresInDays?: number; aiKeyHandle?: string; idempotencyKey: string;
}) {
  const tid = ctx.trace.traceId;
  if (!ctx.principal) raise(tid, "auth.unauthenticated");
  const now = ctx.now();
  const info = await spaceInfo(ctx);
  if (!info.host) raise(tid, "validation.precondition_failed", "this Space has no address yet; set one before inviting");
  const host = info.host;
  const idem = `${ctx.principal.id}:${input.idempotencyKey}`;
  const again = ctx.db.all(`SELECT * FROM members_invites WHERE idem_key = ?`, idem)[0] as InviteRow | undefined;
  if (again) {
    // a retry after a lost answer: the code is stored only as a hash, so an open invite gets a fresh code and the same id
    if (again.state !== "open") raise(tid, "validation.precondition_failed", "that invite is no longer open");
    const code = newCode();
    ctx.db.run(`UPDATE members_invites SET code_hash = ? WHERE id = ?`, hashCode(code), again.id);
    return { invite: inviteView({ ...again }, now), link: await linkFor(ctx, host, info, code) };
  }
  if (input.role === OWNER_ROLE) raise(tid, "validation.precondition_failed", "ownership is transferred, never invited");
  await roleName(ctx, input.role);
  const groups = cleanIds(tid, "groups", input.groups, "grp").filter((g) => g !== EVERYONE);
  for (const groupId of groups) await ctx.call("access.groups.get", { groupId });
  const agents = cleanIds(tid, "agents", input.agents, "agt");
  const projects = cleanIds(tid, "projects", input.projects, "prj");
  const channels = cleanIds(tid, "channels", input.channels, "chn");
  const email = input.email?.trim().toLowerCase();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) raise(tid, "validation.bad_input", "that email address does not look right");
    const dup = invitesAll(ctx).find((r) => r.email === email && stateOf(r, now) === "open");
    if (dup) raise(tid, "validation.duplicate", "that person already has an open invite");
  }
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 90) raise(tid, "validation.bad_input", "an invite lasts 1 to 90 days");
  const code = newCode();
  const row: InviteRow = {
    id: nid("inv"), code_hash: hashCode(code), role: input.role, groups: JSON.stringify(groups), agents: JSON.stringify(agents), projects: JSON.stringify(projects),
    channels: JSON.stringify(channels), email: email ?? null, expires_at: now + days * DAY_MS, created_by: ctx.principal.id, state: "open",
    ai_key_handle: input.aiKeyHandle ?? null, accepted_by: null, accepted_at: null, idem_key: idem, created_at: now,
  };
  ctx.db.run(
    `INSERT INTO members_invites (id, code_hash, role, groups, agents, projects, channels, email, expires_at, created_by, state, ai_key_handle, accepted_by, accepted_at, idem_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.code_hash, row.role, row.groups, row.agents, row.projects, row.channels, row.email, row.expires_at, row.created_by, row.state, row.ai_key_handle, row.accepted_by, row.accepted_at, row.idem_key, row.created_at);
  ctx.emit("member.invited", row.id, { inviteId: row.id, role: row.role, expiresAt: row.expires_at });
  return { invite: inviteView(row, now), link: await linkFor(ctx, host, info, code) };
}

/** The scope row of an invite made from inside a chat, or nothing for an ordinary invite. */
export function guestOf(ctx: MembersCtx, inviteId: string): { level: "view" | "reply" } | undefined {
  const row = ctx.db.all(`SELECT level FROM members_invite_scope WHERE invite_id = ?`, inviteId)[0] as { level?: string } | undefined;
  return row ? { level: row.level === "reply" ? "reply" : "view" } : undefined;
}

/**
 * members.invites.guest: an email invite as a guest of one chat (called by threads.invite_guest, as the person inviting). The role is guest and the only place is the channel; the level says whether the guest only
 * reads or writes too. Who may invite into the chat is the chat's to say, so this takes no permission of its own; what the guest gets is checked again when they join, against what the inviter still holds.
 */
export async function invitesGuest(ctx: MembersCtx, input: { email: string; scope: { type: string; id: string }; level?: "view" | "reply"; idempotencyKey: string }) {
  const tid = ctx.trace.traceId;
  if (((ctx as { depth?: number }).depth ?? 0) < 1 || ctx.principal?.kind !== "person") raise(tid, "permission.no_grant", "A guest is invited from inside a chat.");
  if (input.scope.type !== "channel" || !input.scope.id.startsWith("chn_")) raise(tid, "validation.bad_input", "A guest is invited to a channel's chat.");
  const level = input.level ?? "view";
  if (level !== "view" && level !== "reply") raise(tid, "validation.bad_input", "A guest can view or reply.");
  if (!input.email?.trim()) raise(tid, "validation.bad_input", "A guest is invited by email.");
  const made = await invitesCreate(ctx, { role: GUEST_ROLE, email: input.email, channels: [input.scope.id], expiresInDays: DEFAULT_EXPIRY_DAYS, idempotencyKey: input.idempotencyKey });
  ctx.db.run(`INSERT OR REPLACE INTO members_invite_scope (invite_id, level) VALUES (?, ?)`, made.invite.id, level);
  return made;
}

export async function invitesExtend(ctx: MembersCtx, input: { inviteId: string; expiresInDays: number }) {
  const tid = ctx.trace.traceId;
  const r = mustInvite(ctx, input.inviteId);
  if (r.state !== "open") raise(tid, "validation.precondition_failed", `a ${r.state} invite cannot be extended`);
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 90) raise(tid, "validation.bad_input", "an invite lasts 1 to 90 days");
  const expires = ctx.now() + input.expiresInDays * DAY_MS;
  ctx.db.run(`UPDATE members_invites SET expires_at = ? WHERE id = ?`, expires, r.id);
  return { invite: inviteView({ ...r, expires_at: expires }, ctx.now()) };
}

export async function invitesRevoke(ctx: MembersCtx, input: { inviteId: string }) {
  const tid = ctx.trace.traceId;
  const r = mustInvite(ctx, input.inviteId);
  if (r.state === "revoked") return ok;
  if (r.state === "accepted") raise(tid, "validation.precondition_failed", "that invite was already used; remove the person instead");
  ctx.db.run(`UPDATE members_invites SET state = ? WHERE id = ?`, "revoked", r.id);
  ctx.emit("member.invite_revoked", r.id, { inviteId: r.id });
  return ok;
}

export async function invitesPreview(ctx: MembersCtx, input: { code: string }) {
  const tid = ctx.trace.traceId;
  const r = inviteByCode(ctx, input.code);
  // a revoked or used code reads exactly like one that never existed
  if (!r || r.state !== "open") raise(tid, "auth.invalid_code");
  if (r.expires_at <= ctx.now()) raise(tid, "auth.expired");
  const info = await spaceInfo(ctx);
  let invitedBy = r.created_by;
  try {
    const p = (await ctx.call("access.principals.get", { principal: { kind: "person", id: r.created_by } })) as { principal: { name: string } };
    invitedBy = p.principal.name;
  } catch { /* the join page shows the id when the directory cannot be read before sign-in */ }
  let role = r.role;
  try { role = await roleName(ctx, r.role); } catch { /* same */ }
  const out: { spaceId: string; spaceName: string; logoFileId?: string; invitedBy: string; role: string; expiresAt: number; fingerprint: string; ssoRequired?: { key: string; title: string }[] } = {
    spaceId: info.id, spaceName: info.name, invitedBy, role, expiresAt: r.expires_at, fingerprint: info.fingerprint,
  };
  if (currentPolicy(ctx).requireSso) out.ssoRequired = enabledProviders(ctx);
  if (info.logoFileId) out.logoFileId = info.logoFileId;
  return out;
}

// ---- the join effects

export interface JoinStep {
  k: string; state: "pending" | "done" | "failed"; error?: string; tries: number;
  /** what the Space held for this step when it first failed (areaState); a retry runs only while that is still so */
  seen?: string | null;
  /** set when a retry was dropped because someone changed this since: the step will not run again */
  dropped?: string;
}

function stepsFor(r: InviteRow, guest?: { level: "view" | "reply" }): JoinStep[] {
  // a guest of one chat: the guest role, that chat and what they may do in it, and nothing the Space gives everyone (no Everyone group, no home channel, no company mailbox)
  if (guest) return [`role:${r.role}`, ...listOf(r.channels).flatMap((c) => [`channel:${c}`, `grant:channel:${c}:${guest.level}`]), "checklist"].map((k) => ({ k, state: "pending" as const, tries: 0 }));
  // Everyone carries what the Space shares with everyone (agents, records, files, skills, Vault items: owner D22); the Space's first channel (#vyre) is a step of its own
  const keys = [`role:${r.role}`, `group:${EVERYONE}`, "home"];
  for (const g of listOf(r.groups)) if (g !== EVERYONE) keys.push(`group:${g}`);
  for (const p of listOf(r.projects)) keys.push(`project:${p}`);
  for (const c of listOf(r.channels)) keys.push(`channel:${c}`);
  for (const a of listOf(r.agents)) keys.push(`agent:${a}`);
  // their own mail and calendar, when the company is connected (Google Workspace or Microsoft 365): matched by the address they were invited at
  keys.push("company");
  // The first-run checklist is a function of the person's events (spaces.onboarding.get), so it exists the moment the person does; the step records that it was seen.
  keys.push("checklist");
  return keys.map((k) => ({ k, state: "pending" as const, tries: 0 }));
}

async function runStep(ctx: MembersCtx, personId: string, step: JoinStep, inviteId?: string): Promise<void> {
  const who = { kind: "person", id: personId };
  const colon = step.k.indexOf(":");
  const kind = colon < 0 ? step.k : step.k.slice(0, colon);
  const arg = colon < 0 ? "" : step.k.slice(colon + 1);
  if (kind === "role") await ctx.call("access.roles.assign", { subject: who, roleId: arg });
  else if (kind === "group") await ctx.call("access.groups.add_member", { groupId: arg, member: who });
  else if (kind === "project") await ctx.call("projects.members.set", { projectId: arg, principal: personId, role: "member", idempotencyKey: `join:${personId}:project:${arg}` });
  else if (kind === "channel") await ctx.call("channels.members.add", { channelId: arg, personIds: [personId] });
  // the agent is the inviter's to give: the grant is their act, tagged with the invite (the joiner could give nothing, and the host never gives on its own)
  else if (kind === "agent") {
    const inv = inviteId ? inviteById(ctx, inviteId) : undefined;
    if (!inv) throw new Error("the invite is gone");
    await ctx.call("access.join_share", { resource: { type: "agent", id: arg }, person: personId, level: "use", inviter: inv.created_by, source: `invite:${inv.id}` });
  }
  // the level a guest was invited at, given as the inviter's act while they could still give it (never more than they hold)
  else if (kind === "grant") {
    const [type, id, level] = arg.split(":");
    const inv = inviteId ? inviteById(ctx, inviteId) : undefined;
    if (!inv || !type || !id) throw new Error("the invite is gone");
    await ctx.call("access.join_share", { resource: { type, id }, person: personId, level: level === "reply" ? "use" : "view", inviter: inv.created_by, source: `invite:${inv.id}` });
  }
  else if (kind === "home") await ctx.call("channels.home_join", { personId });
  else if (kind === "company") {
    const provider = companyConnected(ctx as never);
    if (provider) await ctx.call(provider === "google" ? "google.dwd.sync_members" : "ms.consent.sync_members", {});
  }
}

/** Steps tried this many times without working show to admins in Console Overview (they are still tried again). */
export const JOIN_SURFACE_AFTER = 3;
/** The periodic retry stops trying a step after this many failures; an admin's Retry starts it again. */
export const JOIN_MAX_TRIES = 50;

/**
 * What the Space holds now for the thing a join step gives: the person's roles, whether they are in the group or the channel, their project role, their levels on the agent or resource. A retry
 * compares it with what was there when the step first failed: if someone changed it since (an admin gave another role, took them out of a channel, set a project role), the admin's change wins
 * and the step is dropped. Null: the step gives nothing anyone can take away (home channel, company mail, checklist). Throws when it cannot be read; the step then waits.
 */
async function areaState(ctx: MembersCtx, personId: string, step: JoinStep): Promise<string | null> {
  const colon = step.k.indexOf(":");
  const kind = colon < 0 ? step.k : step.k.slice(0, colon);
  const arg = colon < 0 ? "" : step.k.slice(colon + 1);
  if (kind === "role" || kind === "group") {
    const p = ((await ctx.call("access.principals.get", { principal: { kind: "person", id: personId } })) as { principal: { roles?: string[]; groups?: string[] } }).principal;
    return JSON.stringify([...((kind === "role" ? p.roles : p.groups) ?? [])].sort());
  }
  if (kind === "project") {
    const ms = ((await ctx.call("projects.members.list", { projectId: arg })) as { members?: { principal: string; role: string }[] }).members ?? [];
    return ms.find((m) => m.principal === personId)?.role ?? "none";
  }
  if (kind === "channel") {
    const ch = ((await ctx.call("channels.get", { channelId: arg })) as { channel: { members?: { id: string }[] } }).channel;
    return String((ch.members ?? []).some((m) => m.id === personId));
  }
  if (kind === "agent" || kind === "grant") {
    const resource = kind === "agent" ? { type: "agent", id: arg } : { type: arg.split(":")[0]!, id: arg.split(":")[1]! };
    const shares = ((await ctx.call("access.shares_of", { resource })) as { shares?: { grant: { subject: { id: string }; level: string } }[] }).shares ?? [];
    return JSON.stringify(shares.filter((x) => x.grant.subject.id === personId).map((x) => x.grant.level).sort());
  }
  return null;
}

const logWarn = (ctx: MembersCtx, msg: string, attrs: Record<string, unknown>): void => { (ctx as { log?: { warn?(m: string, a?: Record<string, unknown>): void } }).log?.warn?.(msg, attrs); };

/**
 * Run every pending join step, for one person or for all. A step that fails is kept with its error and tried again next time; a step that worked is never run twice.
 * An admin's later change always wins: a retry never gives back what someone changed or took away after the join (areaState), and nothing runs for a person who was removed (their steps are
 * dropped) or is suspended (their steps wait). One person's steps run one pass at a time (lib/one-at-a-time.ts), so the accept and the periodic retry never run the same step side by side.
 */
export async function drainJoins(ctx: MembersCtx, personId?: string, opts: { periodic?: boolean } = {}): Promise<{ applied: number; pending: number }> {
  const ids = (personId
    ? ctx.db.all(`SELECT * FROM members_joins WHERE person_id = ?`, personId)
    : ctx.db.all(`SELECT * FROM members_joins WHERE state = ?`, "pending")) as { person_id: string }[];
  let applied = 0, pending = 0;
  for (const { person_id } of ids) {
    const r = await oneAtATime(`members-join:${ctx.space}:${person_id}`, () => drainOne(ctx, person_id, opts));
    if (r === "applied") applied++; else if (r === "pending") pending++;
  }
  return { applied, pending };
}

async function drainOne(ctx: MembersCtx, personId: string, opts: { periodic?: boolean }): Promise<"applied" | "pending" | "none"> {
  // read again in the queue: another pass may have finished it meanwhile
  const j = (ctx.db.all(`SELECT * FROM members_joins WHERE person_id = ?`, personId) as { person_id: string; invite_id: string; steps: string; state: string }[])[0];
  if (!j || j.state === "applied") return "none";
  const steps = JSON.parse(j.steps) as JoinStep[];
  const before = JSON.parse(j.steps) as JoinStep[];
  const retrying = steps.some((s) => s.state === "failed");
  let status: string | undefined;
  if (retrying) {
    try { status = ((await ctx.call("access.principals.get", { principal: { kind: "person", id: j.person_id } })) as { principal: { status?: string } }).principal.status; }
    catch { status = undefined; }
  }
  if (status === "suspended") return "pending";   // nothing is given to a suspended person; the steps wait for a reactivation
  for (const s of steps) {
    if (s.state === "done") continue;
    if (opts.periodic === true && s.tries >= JOIN_MAX_TRIES) continue;
    if (s.state === "failed") {
      if (status === "removed") { drop(ctx, j.person_id, s, "the person was removed"); continue; }
      if (s.seen !== undefined && s.seen !== null) {
        let now: string | null;
        try { now = await areaState(ctx, j.person_id, s); } catch { continue; }   // cannot tell what the Space holds now: the step waits, it never gives anything unchecked
        if (now !== s.seen) { drop(ctx, j.person_id, s, "someone changed it after the join"); continue; }
      }
    }
    try {
      await runStep(ctx, j.person_id, s, j.invite_id);
      s.state = "done";
      delete s.error;
      delete s.seen;
    } catch (e) {
      s.state = "failed";
      s.tries++;
      s.error = (e as { error?: { code?: string } }).error?.code ?? String(e).slice(0, 120);
      if (s.seen === undefined) { try { s.seen = await areaState(ctx, j.person_id, s); } catch { /* read again at the next try */ } }
    }
  }
  const left = steps.filter((s) => s.state !== "done").length;
  ctx.db.run(`UPDATE members_joins SET steps = ?, state = ?, applied_at = ? WHERE person_id = ?`, JSON.stringify(steps), left === 0 ? "applied" : "pending", left === 0 ? ctx.now() : null, j.person_id);
  // a step that has failed JOIN_SURFACE_AFTER times now shows to admins; say so once, as it crosses
  for (const s of steps) {
    const was = before.find((b) => b.k === s.k);
    if (s.state === "failed" && s.tries === JOIN_SURFACE_AFTER && (was?.tries ?? 0) < JOIN_SURFACE_AFTER) ctx.emit("member.join_stuck", j.person_id, { personId: j.person_id, step: s.k, error: s.error ?? "failed", tries: s.tries });
  }
  return left === 0 ? "applied" : "pending";
}

/**
 * Someone other than the join itself changed what a waiting join step would give (an admin set a project role or took the person out of a channel; the person left it). The step is dropped at
 * once, in the person's queue, so a retry can never undo the change even when the change left no trace in what the Space holds now (put in, then taken out again). From the consumer in impl.ts.
 */
export async function supersedeJoinStep(ctx: MembersCtx, personId: string, key: string, why: string): Promise<void> {
  await oneAtATime(`members-join:${ctx.space}:${personId}`, async () => {
    const j = (ctx.db.all(`SELECT * FROM members_joins WHERE person_id = ?`, personId) as { steps: string; state: string }[])[0];
    if (!j || j.state === "applied") return;
    const steps = JSON.parse(j.steps) as JoinStep[];
    const s = steps.find((x) => x.k === key && x.state !== "done");
    if (!s) return;
    drop(ctx, personId, s, why);
    const left = steps.filter((x) => x.state !== "done").length;
    ctx.db.run(`UPDATE members_joins SET steps = ?, state = ?, applied_at = ? WHERE person_id = ?`, JSON.stringify(steps), left === 0 ? "applied" : "pending", left === 0 ? ctx.now() : null, personId);
  });
}

/** A retry that would undo a later change is not made: the step is closed as done, with why, and said in the log. */
function drop(ctx: MembersCtx, personId: string, s: JoinStep, why: string): void {
  s.state = "done";
  s.dropped = why;
  delete s.error;
  logWarn(ctx, "members: a join step was not retried", { personId, step: s.k, why });
}

// ---- what admins see of joins that have not finished

const STEP_TITLE: Record<string, string> = { role: "Role", group: "Group", home: "The first channel", project: "Project", channel: "Channel", agent: "Agent", company: "Their mail and calendar", checklist: "First-run checklist" };

/** A step in words: "Channel #sales", "Group Sales", never an id when the directory can name it. */
async function stepTitle(ctx: MembersCtx, k: string): Promise<string> {
  const colon = k.indexOf(":");
  const kind = colon < 0 ? k : k.slice(0, colon);
  const arg = colon < 0 ? "" : k.slice(colon + 1);
  const head = STEP_TITLE[kind] ?? "A step";
  if (!arg) return head;
  const name = async (cap: string, input: unknown, pick: (o: Record<string, any>) => unknown): Promise<string | null> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    try { const v = pick((await ctx.call(cap, input)) as Record<string, any>); return typeof v === "string" && v ? v : null; } catch { return null; }   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  let n: string | null = null;
  if (kind === "role") n = await name("access.roles.get", { roleId: arg }, (o) => o["role"]?.name);
  else if (kind === "group") n = await name("access.groups.get", { groupId: arg }, (o) => o["group"]?.name);
  else if (kind === "channel") n = await name("channels.get", { channelId: arg }, (o) => (o["channel"]?.name ? `#${o["channel"].name}` : null));
  else if (kind === "agent") n = await name("agents.get", { agentId: arg }, (o) => o["agent"]?.name);
  return n ? `${head} ${n}` : head;
}

const PLAIN_ERROR: Record<string, string> = {
  "validation.not_found": "It no longer exists.", "permission.no_grant": "Vyre was not allowed to do it.", "permission.role_lacks_permission": "Vyre was not allowed to do it.",
  "permission.not_contained": "Vyre was not allowed to do it.", "validation.precondition_failed": "It was not ready.", "internal.unavailable": "That part of the Space was not answering.",
};

export async function joinsList(ctx: MembersCtx, input: { stuck?: boolean }) {
  const rows = ctx.db.all(`SELECT * FROM members_joins WHERE state = ? ORDER BY joined_at`, "pending") as { person_id: string; invite_id: string; steps: string; joined_at: number }[];
  const out: { personId: string; name: string; joinedAt: number; steps: { key: string; title: string; error: string; tries: number }[]; stuck: boolean }[] = [];
  for (const j of rows) {
    const failed = (JSON.parse(j.steps) as JoinStep[]).filter((st) => st.state === "failed");
    if (failed.length === 0) continue;
    const stuck = failed.some((st) => st.tries >= JOIN_SURFACE_AFTER);
    if (input.stuck === true && !stuck) continue;
    let name = "A new member";
    try { const p = (await ctx.call("access.principals.get", { principal: { kind: "person", id: j.person_id } })) as { principal: { name?: string } }; if (p.principal.name) name = p.principal.name; } catch { /* the line keeps "A new member" */ }
    const steps = [];
    for (const st of failed) steps.push({ key: st.k, title: await stepTitle(ctx, st.k), error: PLAIN_ERROR[st.error ?? ""] ?? "It did not work.", tries: st.tries });
    out.push({ personId: j.person_id, name, joinedAt: j.joined_at, steps, stuck });
  }
  return { joins: out };
}

/** An admin's Retry: run the person's steps that have not worked now, whatever their count. */
export async function joinsRetry(ctx: MembersCtx, input: { personId: string }) {
  const r = await drainJoins(ctx, input.personId);
  const left = (await joinsList(ctx, {})).joins.find((j) => j.personId === input.personId);
  return { ...r, steps: left?.steps ?? [] };
}

// ---- the seam identity calls

/** What identity's ctx.invites needs. peek never spends; accept marks the invite used and queues the join effects. */
export function invitesSeam(ctx: MembersCtx): { peek(code: string): SeamInvite | "invalid" | "expired"; accept(inviteId: string, personId: string): void } {
  return {
    peek(code) {
      if (!normCode(code)) return "invalid";
      const r = inviteByCode(ctx, code);
      if (!r || r.state !== "open") return "invalid";
      if (r.expires_at <= ctx.now()) return "expired";
      return { inviteId: r.id, role: r.role, groups: listOf(r.groups), invitedBy: r.created_by, ...(r.email ? { email: r.email } : {}) };
    },
    accept(inviteId, personId) {
      const r = inviteById(ctx, inviteId);
      if (!r) raise(ctx.trace.traceId, "auth.invalid_code");
      if (r.state === "accepted" && r.accepted_by === personId) return;
      if (r.state !== "open") raise(ctx.trace.traceId, "auth.invalid_code");
      if (r.expires_at <= ctx.now()) raise(ctx.trace.traceId, "auth.expired");
      const got = ctx.db.run(`UPDATE members_invites SET state = ?, accepted_by = ?, accepted_at = ? WHERE id = ? AND state = ?`, "accepted", personId, ctx.now(), r.id, "open");
      if (got.changes !== 1) raise(ctx.trace.traceId, "auth.invalid_code");
      ctx.db.run(`INSERT OR REPLACE INTO members_joins (person_id, invite_id, steps, state, joined_at, applied_at) VALUES (?, ?, ?, ?, ?, ?)`, personId, r.id, JSON.stringify(stepsFor(r, guestOf(ctx, r.id))), "pending", ctx.now(), null);
    },
  };
}

export async function accept(ctx: MembersCtx, input: {
  code: string; username: string; displayName?: string; password: string; deviceName: string; deviceClass?: Dev; keys: unknown; ssoProvider?: string;
}) {
  const tid = ctx.trace.traceId;
  const r = inviteByCode(ctx, input.code);
  if (!r || r.state !== "open") raise(tid, "auth.invalid_code");
  if (r.expires_at <= ctx.now()) raise(tid, "auth.expired");
  const out = (await ctx.call("invites.accept_create_account", {
    code: input.code.trim(), username: input.username, ...(input.displayName ? { displayName: input.displayName } : {}), password: input.password,
    deviceName: input.deviceName, deviceClass: input.deviceClass ?? "web", keys: input.keys, ...(input.ssoProvider ? { ssoProvider: input.ssoProvider } : {}),
  })) as { status: string; session?: { sessionId: string; token: string; epoch: number } };
  const after = mustInvite(ctx, r.id);
  if (out.status !== "ok" || !out.session || after.state !== "accepted" || !after.accepted_by) {
    raise(tid, "internal.unexpected", "the account was not created");
  }
  await drainJoins(ctx, after.accepted_by);
  return { personId: after.accepted_by, sessionId: out.session.sessionId, token: out.session.token, epoch: out.session.epoch };
}
