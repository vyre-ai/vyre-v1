// The reusable "Request to join" link (lane l-consolidate). An admin turns it on once and shares the address; anyone who opens it can ASK to join (a name and an email), never join.
// A request waits in Console > People > Requests. Approve makes an ordinary one-time invite for that email at the link's role (so the account, keys and join steps are the invite's own path); Decline closes it.
// DECISION: the link code is stored plainly (members_join_link.code), not as a hash like an invite code, because a reusable link must be shown again. A leaked link only lets someone ask, every request needs an admin, and Rotate ends it.
// DECISION: one link per Space. Off keeps the row (role, counts); turning it on again makes a fresh code, so an address that was shared before stays dead.
import type { MembersCtx } from "../projections.ts";
import { GUEST_ROLE, OWNER_ROLE, hashCode, me, newCode, nid, normCode, page, raise } from "../projections.ts";
import { invitesCreate, roleName, spaceInfo } from "./invite.ts";

const ok = { ok: true } as const;
const MAIN = "main";

interface LinkRow { id: string; code: string; code_hash: string; role: string; state: "on" | "off"; created_by: string; created_at: number; rotated_at: number | null }
interface RequestRow { id: string; name: string; email: string; note: string | null; role: string; state: "waiting" | "approved" | "declined"; created_at: number; decided_by: string | null; decided_at: number | null; invite_id: string | null }

const linkRow = (ctx: MembersCtx): LinkRow | undefined => ctx.db.all(`SELECT * FROM members_join_link WHERE id = ?`, MAIN)[0] as LinkRow | undefined;
const requestRows = (ctx: MembersCtx): RequestRow[] => ctx.db.all(`SELECT * FROM members_join_requests ORDER BY created_at DESC, id DESC`) as RequestRow[];

/** The address a person opens. Same shape rule as an invite link: behind a phone address everything secret rides in the fragment (the relay pins the key for this code's hash); elsewhere the code is in the path. */
async function addressFor(ctx: MembersCtx, code: string): Promise<string | undefined> {
  const info = await spaceInfo(ctx);
  if (!info.host) return undefined;
  const fp = info.fingerprint.replace(/\s+/g, "");
  const key = await ctx.phoneInvite?.keyFor(hashCode(code)).catch(() => null);
  if (key && /^[A-Za-z0-9_-]{43}$/.test(key)) return `https://${info.host}/join#${new URLSearchParams({ m: "request", c: code, k: key, fp })}`;
  return `https://${info.host}/join/request/${code}#fp=${fp}`;
}

async function view(ctx: MembersCtx, row: LinkRow | undefined) {
  const all = requestRows(ctx);
  const out: { on: boolean; role: string; waiting: number; total: number; address?: string; createdAt?: number; rotatedAt?: number } = {
    on: row?.state === "on", role: row?.role ?? GUEST_ROLE, waiting: all.filter((r) => r.state === "waiting").length, total: all.length,
  };
  if (row) { out.createdAt = row.created_at; if (row.rotated_at) out.rotatedAt = row.rotated_at; }
  if (row?.state === "on") { const a = await addressFor(ctx, row.code); if (a) out.address = a; }
  return out;
}

async function checkRole(ctx: MembersCtx, role: string): Promise<void> {
  if (role === OWNER_ROLE) raise(ctx.trace.traceId, "validation.precondition_failed", "ownership is transferred, never asked for");
  await roleName(ctx, role);
}

export async function joinLinkGet(ctx: MembersCtx) {
  return { link: await view(ctx, linkRow(ctx)) };
}

/** Turn the link on (making it the first time or after Off) or change the role it admits at. Already on at the same role: nothing changes, and the same address comes back. */
export async function joinLinkCreate(ctx: MembersCtx, input: { role?: string }) {
  const tid = ctx.trace.traceId;
  const by = me(ctx).id;
  const now = ctx.now();
  const row = linkRow(ctx);
  const role = input.role ?? row?.role ?? GUEST_ROLE;
  await checkRole(ctx, role);
  if ((await spaceInfo(ctx)).host === undefined) raise(tid, "validation.precondition_failed", "this Space has no address yet; set one before sharing a link");
  if (!row || row.state === "off") {
    const code = newCode();
    if (!row) ctx.db.run(`INSERT INTO members_join_link (id, code, code_hash, role, state, created_by, created_at, rotated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAIN, code, hashCode(code), role, "on", by, now, null);
    else ctx.db.run(`UPDATE members_join_link SET code = ?, code_hash = ?, role = ?, state = ?, rotated_at = ? WHERE id = ?`, code, hashCode(code), role, "on", now, MAIN);
    ctx.emit("member.join_link_changed", MAIN, { change: "on", role, by });
  } else if (row.role !== role) {
    ctx.db.run(`UPDATE members_join_link SET role = ? WHERE id = ?`, role, MAIN);
    ctx.emit("member.join_link_changed", MAIN, { change: "role", role, by });
  }
  return { link: await view(ctx, linkRow(ctx)) };
}

/** A new code; the address people were given stops working at once. Requests already waiting stay. */
export async function joinLinkRotate(ctx: MembersCtx) {
  const row = linkRow(ctx);
  if (!row || row.state !== "on") raise(ctx.trace.traceId, "validation.precondition_failed", "the link is off; turn it on first");
  const code = newCode();
  ctx.db.run(`UPDATE members_join_link SET code = ?, code_hash = ?, rotated_at = ? WHERE id = ?`, code, hashCode(code), ctx.now(), MAIN);
  ctx.emit("member.join_link_changed", MAIN, { change: "rotated", role: row.role, by: me(ctx).id });
  return { link: await view(ctx, linkRow(ctx)) };
}

/** Stop the link from taking requests. Requests already waiting stay for an admin to decide. */
export async function joinLinkDisable(ctx: MembersCtx) {
  const row = linkRow(ctx);
  if (row && row.state === "on") {
    ctx.db.run(`UPDATE members_join_link SET state = ? WHERE id = ?`, "off", MAIN);
    ctx.emit("member.join_link_changed", MAIN, { change: "off", role: row.role, by: me(ctx).id });
  }
  return { link: await view(ctx, linkRow(ctx)) };
}

function openLink(ctx: MembersCtx, code: string): LinkRow {
  const row = normCode(code) ? (ctx.db.all(`SELECT * FROM members_join_link WHERE code_hash = ?`, hashCode(code))[0] as LinkRow | undefined) : undefined;
  // an off or rotated link reads exactly like one that never existed
  if (!row || row.state !== "on") raise(ctx.trace.traceId, "auth.invalid_code");
  return row;
}

/** Join page, before any account: the Space a request link is for. */
export async function joinLinkPreview(ctx: MembersCtx, input: { code: string }) {
  const row = openLink(ctx, input.code);
  const info = await spaceInfo(ctx);
  let role = row.role;
  try { role = await roleName(ctx, row.role); } catch { /* the page shows the id when the directory cannot be read before sign-in */ }
  return { spaceId: info.id, spaceName: info.name, ...(info.logoFileId ? { logoFileId: info.logoFileId } : {}), role, fingerprint: info.fingerprint };
}

/** A person opened the link and asked in. Nothing is created but the request; asking twice from the same email is one request. */
export async function joinLinkRequest(ctx: MembersCtx, input: { code: string; name: string; email: string; note?: string }) {
  const tid = ctx.trace.traceId;
  const link = openLink(ctx, input.code);
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const note = input.note?.trim() ?? "";
  if (!name || name.length > 100) raise(tid, "validation.bad_input", "give your name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) raise(tid, "validation.bad_input", "that email address does not look right");
  if (note.length > 500) raise(tid, "validation.bad_input", "keep the note under 500 characters");
  if (requestRows(ctx).some((r) => r.email === email && r.state === "waiting")) return ok;
  const id = nid("jrq");
  ctx.db.run(`INSERT INTO members_join_requests (id, name, email, note, role, state, created_at, decided_by, decided_at, invite_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, name, email, note || null, link.role, "waiting", ctx.now(), null, null, null);
  ctx.emit("member.join_requested", id, { requestId: id, name, role: link.role });
  return ok;
}

const requestView = (r: RequestRow) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, state: r.state, at: r.created_at,
  ...(r.note ? { note: r.note } : {}), ...(r.invite_id ? { inviteId: r.invite_id } : {}),
});

export async function joinRequestsList(ctx: MembersCtx, input: { state?: "waiting" | "approved" | "declined"; cursor?: string; limit?: number }) {
  const all = requestRows(ctx).filter((r) => !input.state || r.state === input.state).map(requestView);
  const p = page(all, input.cursor, input.limit);
  return { requests: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

function waitingRequest(ctx: MembersCtx, id: string): RequestRow {
  const r = ctx.db.all(`SELECT * FROM members_join_requests WHERE id = ?`, id)[0] as RequestRow | undefined;
  if (!r) raise(ctx.trace.traceId, "validation.not_found", "no such request");
  if (r.state !== "waiting") raise(ctx.trace.traceId, "validation.precondition_failed", `that request was already ${r.state}`);
  return r;
}

/** Approve: make the person a one-time invite at the role the link had, and show the admin that link once (to email or copy). The person joins through the invite, as anyone invited does. */
export async function joinRequestsApprove(ctx: MembersCtx, input: { requestId: string }) {
  const by = me(ctx).id;
  const r = waitingRequest(ctx, input.requestId);
  const made = await invitesCreate(ctx, { role: r.role, email: r.email, idempotencyKey: `join_request:${r.id}` });
  ctx.db.run(`UPDATE members_join_requests SET state = ?, decided_by = ?, decided_at = ?, invite_id = ? WHERE id = ?`, "approved", by, ctx.now(), made.invite.id, r.id);
  return made;
}

export async function joinRequestsDecline(ctx: MembersCtx, input: { requestId: string }) {
  const by = me(ctx).id;
  const existing = ctx.db.all(`SELECT * FROM members_join_requests WHERE id = ?`, input.requestId)[0] as RequestRow | undefined;
  if (existing?.state === "declined") return ok;
  const r = waitingRequest(ctx, input.requestId);
  ctx.db.run(`UPDATE members_join_requests SET state = ?, decided_by = ?, decided_at = ? WHERE id = ?`, "declined", by, ctx.now(), r.id);
  ctx.emit("member.join_request_declined", r.id, { requestId: r.id });
  return ok;
}
