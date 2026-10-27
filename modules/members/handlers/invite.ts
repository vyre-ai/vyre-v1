// Invites and the join (spec 3.13, ARCH 7.13). An invite carries a role, groups, the agents, projects and channels the person starts in, and an expiry.
// The link is the Space address, a one-time code and the Space key fingerprint (as a fragment, so the server never sees it). The code is stored as a hash.
// The accept is the pre-auth path: members.accept checks the invite, asks identity to make the account (ruling 23, identity emits member.joined and principal.created once),
// then runs the join effects. The same effects run from the seam identity calls when a host drives identity directly, so they never depend on which door the person used.
import type { MembersCtx, InviteRow, SeamInvite } from "../projections.ts";
import {
  DAY_MS, DEFAULT_EXPIRY_DAYS, EVERYONE, OWNER_ROLE, hashCode, inviteById, inviteByCode, inviteView, invitesAll, listOf, mustInvite, newCode, nid, normCode, page, raise, stateOf,
} from "../projections.ts";

const ok = { ok: true } as const;
type Dev = "desktop" | "phone" | "web" | "extension" | "daemon";

interface SpaceInfo { id: string; name: string; logoFileId?: string; fingerprint: string; host?: string }

async function spaceInfo(ctx: MembersCtx): Promise<SpaceInfo> {
  const out = (await ctx.call("spaces.get", {})) as { space: { id: string; name: string; logoFileId?: string; fingerprint: string; address?: { host?: string } } };
  const s = out.space;
  const info: SpaceInfo = { id: s.id, name: s.name, fingerprint: s.fingerprint };
  if (s.logoFileId) info.logoFileId = s.logoFileId;
  if (s.address?.host) info.host = s.address.host;
  return info;
}

async function roleName(ctx: MembersCtx, roleId: string): Promise<string> {
  const out = (await ctx.call("access.roles.get", { roleId })) as { role: { name: string } };
  return out.role.name;
}

function linkFor(host: string, info: SpaceInfo, code: string): string {
  return `https://${host}/join/${code}#fp=${info.fingerprint.replace(/\s+/g, "")}`;
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
    return { invite: inviteView({ ...again }, now), link: linkFor(host, info, code) };
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
  return { invite: inviteView(row, now), link: linkFor(host, info, code) };
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
  const out: { spaceId: string; spaceName: string; logoFileId?: string; invitedBy: string; role: string; expiresAt: number; fingerprint: string } = {
    spaceId: info.id, spaceName: info.name, invitedBy, role, expiresAt: r.expires_at, fingerprint: info.fingerprint,
  };
  if (info.logoFileId) out.logoFileId = info.logoFileId;
  return out;
}

// ---- the join effects

export interface JoinStep { k: string; state: "pending" | "done" | "failed"; error?: string; tries: number }

function stepsFor(r: InviteRow): JoinStep[] {
  const keys = [`role:${r.role}`, `group:${EVERYONE}`];
  for (const g of listOf(r.groups)) if (g !== EVERYONE) keys.push(`group:${g}`);
  for (const p of listOf(r.projects)) keys.push(`project:${p}`);
  for (const c of listOf(r.channels)) keys.push(`channel:${c}`);
  for (const a of listOf(r.agents)) keys.push(`agent:${a}`);
  // The first-run checklist is a function of the person's events (spaces.onboarding.get), so it exists the moment the person does; the step records that it was seen.
  keys.push("checklist");
  return keys.map((k) => ({ k, state: "pending" as const, tries: 0 }));
}

async function runStep(ctx: MembersCtx, personId: string, step: JoinStep): Promise<void> {
  const who = { kind: "person", id: personId };
  const colon = step.k.indexOf(":");
  const kind = colon < 0 ? step.k : step.k.slice(0, colon);
  const arg = colon < 0 ? "" : step.k.slice(colon + 1);
  if (kind === "role") await ctx.call("access.roles.assign", { subject: who, roleId: arg });
  else if (kind === "group") await ctx.call("access.groups.add_member", { groupId: arg, member: who });
  else if (kind === "project") await ctx.call("projects.members.set", { projectId: arg, principal: personId, role: "member", idempotencyKey: `join:${personId}:project:${arg}` });
  else if (kind === "channel") await ctx.call("channels.members.add", { channelId: arg, personIds: [personId] });
  else if (kind === "agent") await ctx.call("access.share", { resource: { type: "agent", id: arg }, subject: who, level: "use", idempotencyKey: `join:${personId}:${arg}` });
}

/** Run every pending join step, for one person or for all. A step that fails is kept with its error and tried again next time; a step that worked is never run twice. */
export async function drainJoins(ctx: MembersCtx, personId?: string): Promise<{ applied: number; pending: number }> {
  const rows = (personId
    ? ctx.db.all(`SELECT * FROM members_joins WHERE person_id = ?`, personId)
    : ctx.db.all(`SELECT * FROM members_joins WHERE state = ?`, "pending")) as { person_id: string; invite_id: string; steps: string; state: string }[];
  let applied = 0, pending = 0;
  for (const j of rows) {
    if (j.state === "applied") continue;
    const steps = JSON.parse(j.steps) as JoinStep[];
    for (const s of steps) {
      if (s.state === "done") continue;
      try {
        await runStep(ctx, j.person_id, s);
        s.state = "done";
        delete s.error;
      } catch (e) {
        s.state = "failed";
        s.tries++;
        s.error = (e as { error?: { code?: string } }).error?.code ?? String(e).slice(0, 120);
      }
    }
    const left = steps.filter((s) => s.state !== "done").length;
    ctx.db.run(`UPDATE members_joins SET steps = ?, state = ?, applied_at = ? WHERE person_id = ?`, JSON.stringify(steps), left === 0 ? "applied" : "pending", left === 0 ? ctx.now() : null, j.person_id);
    if (left === 0) applied++; else pending++;
  }
  return { applied, pending };
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
      return { inviteId: r.id, role: r.role, groups: listOf(r.groups), invitedBy: r.created_by };
    },
    accept(inviteId, personId) {
      const r = inviteById(ctx, inviteId);
      if (!r) raise(ctx.trace.traceId, "auth.invalid_code");
      if (r.state === "accepted" && r.accepted_by === personId) return;
      if (r.state !== "open") raise(ctx.trace.traceId, "auth.invalid_code");
      if (r.expires_at <= ctx.now()) raise(ctx.trace.traceId, "auth.expired");
      const got = ctx.db.run(`UPDATE members_invites SET state = ?, accepted_by = ?, accepted_at = ? WHERE id = ? AND state = ?`, "accepted", personId, ctx.now(), r.id, "open");
      if (got.changes !== 1) raise(ctx.trace.traceId, "auth.invalid_code");
      ctx.db.run(`INSERT OR REPLACE INTO members_joins (person_id, invite_id, steps, state, joined_at, applied_at) VALUES (?, ?, ?, ?, ?, ?)`, personId, r.id, JSON.stringify(stepsFor(r)), "pending", ctx.now(), null);
    },
  };
}

export async function accept(ctx: MembersCtx, input: {
  code: string; username: string; displayName?: string; password: string; deviceName: string; deviceClass?: Dev; keys: unknown;
}) {
  const tid = ctx.trace.traceId;
  const r = inviteByCode(ctx, input.code);
  if (!r || r.state !== "open") raise(tid, "auth.invalid_code");
  if (r.expires_at <= ctx.now()) raise(tid, "auth.expired");
  const out = (await ctx.call("invites.accept_create_account", {
    code: input.code.trim(), username: input.username, ...(input.displayName ? { displayName: input.displayName } : {}), password: input.password,
    deviceName: input.deviceName, deviceClass: input.deviceClass ?? "web", keys: input.keys,
  })) as { status: string; session?: { sessionId: string; token: string; epoch: number } };
  const after = mustInvite(ctx, r.id);
  if (out.status !== "ok" || !out.session || after.state !== "accepted" || !after.accepted_by) {
    raise(tid, "internal.unexpected", "the account was not created");
  }
  await drainJoins(ctx, after.accepted_by);
  return { personId: after.accepted_by, sessionId: out.session.sessionId, token: out.session.token, epoch: out.session.epoch };
}
