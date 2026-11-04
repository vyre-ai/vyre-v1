// Devices and sessions (spec 2.25). Own devices and sessions are the caller's to see and end; anything else needs access.manage (the manifest binds the Space at view and
// these handlers decide, so a stranger's device reads as missing). Revoking is audited by the invoke pipeline (`audit: always`).
import { isSystemCall } from "../../../lib/trust.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { DeviceClass, DevicesCtx, EpochReason } from "../projections.ts";
import {
  bumpEpoch, deviceById, deviceOut, devicesOf, epochOf, mayTouch, me, meRead, mustDevice, nid, pageOf, raise, revokeDevice, sessionOut, sessionsOf, sessionsOfDevice,
  endSession,
} from "../projections.ts";
import type { DeviceRec, SessionRec } from "../projections.ts";

const ok = { ok: true } as const;
/** The host's Ctx has `call`; a hand-built test ctx may not, and then there is no sync module to tell. */
type RevokeCtx = DevicesCtx & { call?: Ctx["call"] };
/** touch and presence ask other modules (home writes the digest, notifications says who is away); a hand-built test ctx may not have call. */
type TouchCtx = DevicesCtx & { call?: Ctx["call"] };

/** Tell sync that this device was revoked, so its replica purges on next contact and its live sockets close (sync.epoch.bump, device scope). A failure stops the revoke call loudly: a revoked device must not keep its copy. */
async function purgeOnSync(ctx: RevokeCtx, d: DeviceRec): Promise<void> {
  if (typeof ctx.call !== "function") return;
  await ctx.call("sync.epoch.bump", { personId: d.person, reason: "device_revoked", deviceId: d.id });
}
type Page = { cursor?: string; limit?: number };

export async function mine(ctx: DevicesCtx, _input: Record<string, never>) {
  const person = meRead(ctx);
  return {
    devices: devicesOf(ctx, person, true).map((d) => deviceOut(d, ctx.device)),
    sessions: sessionsOf(ctx, person).map((s) => sessionOut(s, ctx.device)),
  };
}

export async function list(ctx: DevicesCtx, input: { person?: string; class?: DeviceClass } & Page) {
  const conds = ["deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.person) { conds.push("person = ?"); args.push(input.person); }
  if (input.class) { conds.push("class = ?"); args.push(input.class); }
  const rows = ctx.db.all(`SELECT * FROM devices_device WHERE ${conds.join(" AND ")} ORDER BY lastSeenAt DESC, id DESC`, ...args) as DeviceRec[];
  const p = pageOf(rows, input.cursor, input.limit);
  return { devices: p.items.map((d) => deviceOut(d, ctx.device)), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function get(ctx: DevicesCtx, input: { deviceId: string }) {
  const d = mustDevice(ctx, input.deviceId);
  return { device: deviceOut(d, ctx.device), sessions: sessionsOfDevice(ctx, d.id).map((s) => sessionOut(s, ctx.device)) };
}

export async function rename(ctx: DevicesCtx, input: { deviceId: string; name: string }) {
  const person = me(ctx);
  const d = deviceById(ctx, input.deviceId);
  // renaming is the owner's act only, an admin may end a device but not relabel it
  if (!d || d.person !== person) raise(ctx, "validation.not_found", "no such device");
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) raise(ctx, "validation.bad_input", "a device name is 1 to 80 characters");
  const now = ctx.now();
  ctx.db.run(`UPDATE devices_device SET name = ?, version = ?, updated_at = ? WHERE id = ?`, name, d.version + 1, now, d.id);
  return { device: deviceOut({ ...d, name, version: d.version + 1 }, ctx.device) };
}

export async function revoke(ctx: RevokeCtx, input: { deviceId: string }) {
  const d = mustDevice(ctx, input.deviceId);
  revokeDevice(ctx, d);
  await purgeOnSync(ctx, d);   // also when it was already revoked: a retry after a failed bump heals
  return ok;
}

export async function revokeOthers(ctx: RevokeCtx, _input: Record<string, never>) {
  const person = me(ctx);
  let n = 0;
  for (const d of devicesOf(ctx, person, true)) {
    if (d.id === ctx.device) continue;
    if (revokeDevice(ctx, d)) { n++; await purgeOnSync(ctx, d); }
  }
  return { revoked: n };
}

export async function sessionsList(ctx: DevicesCtx, input: { person?: string } & Page) {
  const person = input.person ?? me(ctx);
  if (!mayTouch(ctx, person)) raise(ctx, "permission.no_grant", "you may list your own sessions only");
  const p = pageOf(sessionsOf(ctx, person), input.cursor, input.limit);
  return { sessions: p.items.map((s) => sessionOut(s, ctx.device)), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function sessionsRevoke(ctx: DevicesCtx, input: { sessionId: string }) {
  const s = ctx.db.all(`SELECT * FROM devices_session WHERE id = ?`, input.sessionId)[0] as SessionRec | undefined;
  if (!s || !mayTouch(ctx, s.person)) raise(ctx, "validation.not_found", "no such session");
  if (s.revoked_at === null) endSession(ctx, s);
  return ok;
}

export async function rotateSpaceKey(ctx: DevicesCtx, _input: { reason?: string }) {
  return { epoch: bumpEpoch(ctx, "space", undefined, "key_rotation") };
}

// ---- system halves: sign-in, sync and the identity/members modules call these

export async function register(ctx: DevicesCtx, input: { person: string; name: string; class: DeviceClass }) {
  const now = ctx.now();
  const id = nid("dev");
  const sessionId = nid("ses");
  const epoch = epochOf(ctx, `person:${input.person}`);
  ctx.db.run(
    `INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.person, input.name.trim() || "Unnamed device", input.class, epoch, now, null, null, 0, now, null);
  ctx.db.run(
    `INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId, input.person, "device", "person", id, now, now, null, null);
  ctx.emit("device.registered", id, { deviceId: id, person: input.person, class: input.class, name: input.name.trim() || "Unnamed device" });
  ctx.emit("session.started", sessionId, { sessionId, person: input.person, deviceId: id });
  return { device: deviceOut(deviceById(ctx, id)!, ctx.device), sessionId };
}

/** How long a person may be gone before their next touch counts as coming back (and writes the While you were away digest). */
export const ABSENCE_MS = 4 * 3_600_000;
/** A touch inside this window of the last one changes nothing: the app touches on activity at most once a minute, and two devices or a quick retry never write twice. */
export const TOUCH_QUIET_MS = 30_000;
/** Seen within this window reads as online (the engine's placement uses the same five minutes). */
export const ONLINE_MS = 5 * 60_000;

/** Last seen of a device. The app calls it on activity (a press, a key, the window coming back), throttled; the device is the caller's current one when none is named. Coming back after
 * ABSENCE_MS or more asks home to write the While you were away digest for the time away (a failure there never fails the touch). */
export async function touch(ctx: TouchCtx, input: { deviceId?: string; location?: string }) {
  const id = input.deviceId ?? ctx.device;
  if (!id) raise(ctx, "validation.bad_input", "name the device");
  const d = deviceById(ctx, id);
  if (!d || (d.person !== ctx.principal.id && !isSystemCall(ctx))) raise(ctx, "validation.not_found", "no such device");   // a person touches only their own devices; a stranger's reads as missing
  if (d.revokedAt !== null) raise(ctx, "auth.device_revoked");
  const now = ctx.now();
  if (d.lastSeenAt !== null && now - d.lastSeenAt < TOUCH_QUIET_MS && (input.location === undefined || input.location === d.location)) return { ...ok, lastSeenAt: d.lastSeenAt };
  const before = lastSeenOf(ctx, d.person);
  ctx.db.run(`UPDATE devices_device SET lastSeenAt = ?, location = ?, updated_at = ? WHERE id = ?`, now, input.location ?? d.location, now, d.id);
  for (const s of sessionsOfDevice(ctx, d.id)) ctx.db.run(`UPDATE devices_session SET last_seen_at = ?, location = ? WHERE id = ?`, now, input.location ?? s.location, s.id);
  let back = false;
  if (before !== null && now - before >= ABSENCE_MS && d.person === ctx.principal.id && typeof ctx.call === "function") {
    back = true;
    try { await ctx.call("home.away_digest" as never, { since: before }); } catch { /* the digest is a courtesy: last seen is what was asked */ }
  }
  return { ...ok, lastSeenAt: now, ...(back ? { back: true } : {}) };
}

/** The newest contact over a person's live devices, or null when none has been seen. */
function lastSeenOf(ctx: DevicesCtx, person: string): number | null {
  let at: number | null = null;
  for (const d of devicesOf(ctx, person, true)) if (d.lastSeenAt !== null && (at === null || d.lastSeenAt > at)) at = d.lastSeenAt;
  return at;
}

type Presence = { personId: string; state: "online" | "away" | "offline"; lastSeenAt?: number; awayUntil?: number };

/** Who is around (D23: on, a steady dot, Appear away): for each person with a device, online when a device was seen in the last ONLINE_MS, away when they set themselves away
 * (notifications.away.who), else offline. Every member may read it; it says when, never where or on what. */
export async function presence(ctx: TouchCtx, input: { people?: string[] }) {
  if (!ctx.principal || (ctx.principal.kind !== "person" && ctx.principal.kind !== "agent" && !isSystemCall(ctx))) raise(ctx, "auth.unauthenticated");
  const now = ctx.now();
  const seen = new Map<string, number | null>();
  for (const d of ctx.db.all(`SELECT * FROM devices_device WHERE deleted_at IS NULL`) as DeviceRec[]) {
    if (d.revokedAt !== null) continue;
    const was = seen.get(d.person);
    if (was === undefined || (d.lastSeenAt !== null && (was === null || d.lastSeenAt > was))) seen.set(d.person, d.lastSeenAt);
  }
  const away = new Map<string, number>();
  if (typeof ctx.call === "function") {
    try {
      const out = (await ctx.call("notifications.away.who" as never, {})) as { people?: { person: string; until: number }[] } | null;
      for (const a of out?.people ?? []) away.set(a.person, a.until);
    } catch { /* nobody reads as away when the list cannot be read */ }
  }
  const want = input.people ? new Set(input.people) : null;
  for (const p of away.keys()) if (!seen.has(p)) seen.set(p, null);
  const people: Presence[] = [];
  for (const [personId, at] of seen) {
    if (want && !want.has(personId)) continue;
    const until = away.get(personId);
    const state: Presence["state"] = until !== undefined ? "away" : at !== null && now - at < ONLINE_MS ? "online" : "offline";
    people.push({ personId, state, ...(at !== null ? { lastSeenAt: at } : {}), ...(until !== undefined ? { awayUntil: until } : {}) });
  }
  people.sort((a, b) => a.personId.localeCompare(b.personId));
  return { people };
}

export async function epoch(ctx: DevicesCtx, _input: Record<string, never>) {
  const person = me(ctx);
  const d = ctx.device ? deviceById(ctx, ctx.device) : undefined;
  return { personEpoch: epochOf(ctx, `person:${person}`), spaceEpoch: epochOf(ctx, "space"), revoked: !!d && d.revokedAt !== null };
}

export async function epochBump(ctx: DevicesCtx, input: { person: string; reason: EpochReason }) {
  // advancing a person's epoch purges their devices: only the server and other modules (members.suspend, a password reset) may, never a direct call from someone else
  if (!isSystemCall(ctx) && input.person !== ctx.principal.id) raise(ctx, "permission.no_grant", "This is for the server and for other modules, not for a direct call.");
  return { epoch: bumpEpoch(ctx, "person", input.person, input.reason) };
}

export async function purgeAck(ctx: DevicesCtx, input: { deviceId: string }) {
  const d = deviceById(ctx, input.deviceId);
  if (!d || (!mayTouch(ctx, d.person) && !isSystemCall(ctx))) raise(ctx, "validation.not_found", "no such device");   // the person the device belongs to, or whoever manages access when that person was removed, says it is clean
  if (d.revokedAt === null) raise(ctx, "validation.precondition_failed", "only a revoked device is purged");
  if (ctx.db.all(`SELECT device_id FROM devices_purge WHERE device_id = ?`, d.id).length === 0) {
    ctx.db.run(`INSERT INTO devices_purge (device_id, acked_at) VALUES (?, ?)`, d.id, ctx.now());
    ctx.emit("device.purged", d.id, { deviceId: d.id, person: d.person });
  }
  return ok;
}

